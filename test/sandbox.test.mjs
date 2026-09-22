import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Utopia, { NotFoundError } from "../dist/index.js";

// Runs against the local sandbox API (sdks/sandbox/server.mjs) when
// UTOPIA_SANDBOX points at the sandbox.json it writes.
const file = process.env.UTOPIA_SANDBOX;
const sandbox = file ? JSON.parse(readFileSync(file, "utf8")) : null;

async function play(method, path) {
  const res = await fetch(sandbox.origin + "/__sandbox" + path, {
    method,
    // Like a browser, a POST names its origin, or the server refuses it.
    headers: method === "GET" ? {} : { "content-type": "application/json", origin: sandbox.origin },
    body: method === "GET" ? undefined : "{}",
  });
  const body = await res.text();
  assert.equal(res.status, 200, `Sandbox ${path}: ${body}`);
  return JSON.parse(body);
}

test(
  "takes a payment and verifies a server-signed webhook against the sandbox API",
  { skip: sandbox ? false : "Set UTOPIA_SANDBOX to run against the sandbox API" },
  async () => {
    const utopia = new Utopia({ apiKey: sandbox.api_key, baseUrl: sandbox.base_url, maxRetries: 0 });
    const product = await utopia.products.create({ name: "Node library test", price: 5000, currency: "AED" });
    const session = await utopia.checkoutSessions.create({
      product_cart: [{ product_id: product.product_id }],
      customer: { email: "node-sdk@example.com", name: "Node Library" },
      metadata: { order_id: "node-1" },
    });
    const paid = await play("POST", `/checkout_sessions/${session.session_id}/pay`);

    const payment = await utopia.payments.retrieve(paid.payment_id);
    assert.equal(payment.status, "succeeded");
    assert.equal(payment.total_amount, 5000);
    assert.equal(payment.metadata.order_id, "node-1");
    let found = false;
    for await (const listed of utopia.payments.list({ limit: 1 }))
      found ||= listed.payment_id === paid.payment_id;
    assert.ok(found, "Pagination reaches the payment");
    await assert.rejects(() => utopia.payments.retrieve("pay_" + "0".repeat(32)), NotFoundError);

    const endpoint = await utopia.webhookEndpoints.create({
      url: "https://example.com/webhooks/utopia",
      disabled: true,
    });
    const delivery = await play("GET", "/signed-event?secret=" + encodeURIComponent(endpoint.secret));
    const event = utopia.webhooks.unwrap(delivery.body, delivery.headers, endpoint.secret);
    assert.equal(event.type, "payment.succeeded");
  },
);
