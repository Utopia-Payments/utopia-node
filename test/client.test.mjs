import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import Utopia, {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  UtopiaError,
  WebhookVerificationError,
} from "../dist/index.js";

const key = "sk_test_" + "a".repeat(43);

/** A throwaway API that records requests and answers with `handler`. */
async function mockApi(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const request = {
      method: req.method,
      url: new URL(req.url, "http://localhost"),
      headers: req.headers,
      body: raw ? JSON.parse(raw) : undefined,
    };
    requests.push(request);
    const { status = 200, json = {}, headers = {} } = await handler(request, requests.length);
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(json));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new Utopia({
    apiKey: key,
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    maxRetries: 2,
  });
  return { client, requests, close: () => new Promise((r) => server.close(r)) };
}

test("requests are authenticated JSON, and creates carry an idempotency key", async () => {
  const api = await mockApi((req) => ({
    json: { object: "checkout_session", session_id: "cks_1", checkout_url: "https://x" },
  }));
  try {
    const session = await api.client.checkoutSessions.create({
      product_cart: [{ product_id: "pdt_1", quantity: 2 }],
      return_url: "https://shop.example/thanks",
    });
    assert.equal(session.session_id, "cks_1");
    const [request] = api.requests;
    assert.equal(request.method, "POST");
    assert.equal(request.url.pathname, "/api/v1/checkout_sessions");
    assert.equal(request.headers.authorization, "Bearer " + key);
    assert.match(request.headers["user-agent"], /^utopia-node\//);
    assert.match(request.headers["idempotency-key"], /^[0-9a-f-]{36}$/);
    assert.deepEqual(request.body.product_cart, [{ product_id: "pdt_1", quantity: 2 }]);

    await api.client.checkoutSessions.create(
      { product_cart: [{ product_id: "pdt_1" }] },
      { idempotencyKey: "order-42" },
    );
    assert.equal(api.requests[1].headers["idempotency-key"], "order-42");
    assert.equal(api.client.livemode, false);
  } finally {
    await api.close();
  }
});

test("server errors are retried with the same idempotency key", async () => {
  const api = await mockApi((req, n) =>
    n < 3
      ? { status: n === 1 ? 503 : 429, json: { code: "UNAVAILABLE", message: "busy" }, headers: { "retry-after": "0" } }
      : { json: { object: "product", product_id: "pdt_9" } },
  );
  try {
    const product = await api.client.products.create({ name: "Plan", price: 900, currency: "AED" });
    assert.equal(product.product_id, "pdt_9");
    assert.equal(api.requests.length, 3);
    assert.equal(new Set(api.requests.map((r) => r.headers["idempotency-key"])).size, 1);
  } finally {
    await api.close();
  }
});

test("API errors become typed exceptions with the API's code", async () => {
  const api = await mockApi((req) =>
    req.url.pathname.endsWith("/account")
      ? { status: 401, json: { code: "UNAUTHORIZED", message: "Invalid key" } }
      : req.url.pathname.includes("/payments/")
        ? { status: 404, json: { code: "NOT_FOUND", message: "No such payment" } }
        : { status: 429, json: { code: "RATE_LIMITED", message: "Slow down" } },
  );
  try {
    await assert.rejects(api.client.account.retrieve(), (e) => e instanceof AuthenticationError && e.status === 401);
    await assert.rejects(
      api.client.payments.retrieve("pay_missing"),
      (e) => e instanceof NotFoundError && e.code === "NOT_FOUND" && e.message === "No such payment",
    );
    // maxRetries is 2, so the limit is retried before the error surfaces.
    await assert.rejects(() => api.client.events.list(), (e) => e instanceof RateLimitError);
    await assert.rejects(api.client.events.list().catch((e) => Promise.reject(e)), RateLimitError);
  } finally {
    await api.close();
  }
  assert.throws(() => new Utopia({ apiKey: "pk_nope" }), /secret API key/);
});

test("lists can be awaited as one page or iterated across every page", async () => {
  const pages = {
    "": { items: [{ payment_id: "pay_1" }, { payment_id: "pay_2" }], has_more: true, next_cursor: "c2" },
    c2: { items: [{ payment_id: "pay_3" }], has_more: false, next_cursor: null },
  };
  const api = await mockApi((req) => ({ json: pages[req.url.searchParams.get("cursor") ?? ""] }));
  try {
    const first = await api.client.payments.list({ limit: 2, status: "succeeded" });
    assert.equal(first.items.length, 2);
    assert.equal(api.requests[0].url.searchParams.get("status"), "succeeded");
    const ids = [];
    for await (const payment of api.client.payments.list({ limit: 2 })) ids.push(payment.payment_id);
    assert.deepEqual(ids, ["pay_1", "pay_2", "pay_3"]);
  } finally {
    await api.close();
  }
});

test("subscriptions cancel now or at the end of the period", async () => {
  const api = await mockApi((req) => ({ json: { object: "subscription", ...req.body } }));
  try {
    await api.client.subscriptions.cancel("sub_1");
    await api.client.subscriptions.cancel("sub_1", { atPeriodEnd: true });
    assert.deepEqual(api.requests.map((r) => [r.method, r.url.pathname, r.body]), [
      ["PATCH", "/api/v1/subscriptions/sub_1", { status: "cancelled" }],
      ["PATCH", "/api/v1/subscriptions/sub_1", { cancel_at_period_end: true }],
    ]);
  } finally {
    await api.close();
  }
});

test("webhook signatures are verified against the raw body", () => {
  const secret = "whsec_" + randomBytes(24).toString("base64");
  const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", data: { payment_id: "pay_1" } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = (content) =>
    "v1," +
    createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(content).digest("base64");
  const headers = {
    "webhook-id": "evt_1",
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,bm9wZQ== ${sign(`evt_1.${timestamp}.${body}`)}`,
  };
  const client = new Utopia({ apiKey: key });
  assert.equal(client.webhooks.unwrap(body, headers, secret).data.payment_id, "pay_1");
  assert.equal(client.webhooks.unwrap(Buffer.from(body), new Headers(headers), secret).type, "payment.succeeded");
  assert.throws(() => client.webhooks.unwrap(body + " ", headers, secret), WebhookVerificationError);
  assert.throws(
    () => client.webhooks.unwrap(body, { ...headers, "webhook-timestamp": String(Number(timestamp) - 600) }, secret),
    /too old/,
  );
  assert.throws(() => client.webhooks.unwrap(body, {}, secret), /Missing/);
});

test("a webhook secret that is not a real whsec_ key verifies nothing", () => {
  const client = new Utopia({ apiKey: key });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { "webhook-id": "evt_1", "webhook-timestamp": timestamp, "webhook-signature": "v1,AA==" };
  for (const secret of ["", "whsec_", " ", undefined, "whsec_not base64!", "whsec_YQ"])
    assert.throws(
      () => client.webhooks.unwrap("{}", headers, secret),
      (e) => e instanceof WebhookVerificationError && /secret/.test(e.message),
      `secret ${JSON.stringify(secret)} was accepted`,
    );
});

test("the base URL must use TLS unless it points at this machine", () => {
  for (const baseUrl of ["http://api.example.com/api/v1", "ftp://localhost/api/v1", "not a url"])
    assert.throws(
      () => new Utopia({ apiKey: key, baseUrl }),
      (e) => e instanceof UtopiaError && e.code === "INVALID_BASE_URL",
      `${baseUrl} was accepted`,
    );
  for (const baseUrl of [
    "https://api.example.com/api/v1",
    "http://localhost:4010/api/v1",
    "http://127.0.0.1:4010/api/v1/",
    "http://[::1]:4010/api/v1",
  ])
    assert.doesNotThrow(() => new Utopia({ apiKey: key, baseUrl }), baseUrl);
});

test("the CommonJS build works with require()", () => {
  const require = createRequire(import.meta.url);
  const sdk = require("../dist/index.cjs");
  const Client = sdk.Utopia ?? sdk.default;
  assert.equal(typeof new Client({ apiKey: key }).checkoutSessions.create, "function");
});
