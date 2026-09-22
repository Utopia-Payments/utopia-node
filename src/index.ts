/**
 * Official Node.js and TypeScript library for the Utopia Payments API.
 * Docs: https://utopia-payments.com/docs/
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://utopia-payments.com/api/v1";

// ---------------------------------------------------------------------------
// Resource types. Amounts are integer minor units (fils, cents); timestamps
// are ISO 8601 strings; ids carry a type prefix (pay_, cks_, sub_ …).
// ---------------------------------------------------------------------------

export type Currency =
  | "USD"
  | "EUR"
  | "GBP"
  | "SAR"
  | "AED"
  | "EGP"
  | "KWD"
  | "QAR"
  | "BHD"
  | "OMR";
export type Metadata = Record<string, string>;
export type BillingInterval = "day" | "week" | "month" | "year";

export interface Page<T> {
  items: T[];
  has_more: boolean;
  next_cursor: string | null;
}
export interface ListParams {
  /** 1 to 100, default 20. */
  limit?: number;
  /** The next_cursor of the previous page. */
  cursor?: string;
}

export interface Account {
  object: "account";
  business_name: string | null;
  support_email: string | null;
  livemode: boolean;
  payments_enabled: boolean;
  currencies: Currency[];
}

export interface Product {
  object: "product";
  product_id: string;
  name: string;
  description: string;
  price: number;
  currency: Currency;
  billing: "one_time" | "recurring";
  billing_interval: BillingInterval | null;
  interval_count: number | null;
  status: "active" | "draft" | "archived";
  metadata: Metadata;
  created_at: string;
  updated_at: string | null;
}
export interface ProductCreateParams {
  name: string;
  description?: string;
  price: number;
  currency: Currency;
  billing?: "one_time" | "recurring";
  billing_interval?: BillingInterval;
  interval_count?: number;
  status?: "active" | "draft" | "archived";
  metadata?: Metadata;
}
export type ProductUpdateParams = Partial<ProductCreateParams>;
export interface ProductListParams extends ListParams {
  status?: Product["status"];
  billing?: Product["billing"];
}

export interface Customer {
  object: "customer";
  customer_id: string;
  name: string;
  email: string;
  phone_number: string | null;
  metadata: Metadata;
  created_at: string;
}
export interface CustomerCreateParams {
  email: string;
  name: string;
  /** E.164, like +971501234567. */
  phone_number?: string;
  metadata?: Metadata;
}
export type CustomerUpdateParams = Partial<CustomerCreateParams>;
export interface CustomerListParams extends ListParams {
  email?: string;
}

export interface CheckoutSession {
  object: "checkout_session";
  session_id: string;
  kind: "payment" | "subscription";
  status: "open" | "complete" | "expired";
  /** Redirect the customer here. Null once the session is complete or expired. */
  checkout_url: string | null;
  total_amount: number;
  currency: Currency;
  product_cart: {
    product_id: string | null;
    name: string;
    quantity: number;
    unit_amount: number;
  }[];
  customer: { name: string | null; email: string | null; phone_number: string | null };
  return_url: string | null;
  payment_id: string | null;
  subscription_id: string | null;
  metadata: Metadata;
  livemode: boolean;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}
export type ProductCartItem =
  | { product_id: string; quantity?: number }
  /** A one-time item priced inline, for carts that don't map to saved products. */
  | { name: string; unit_amount: number; currency: Currency; quantity?: number };
export interface CheckoutSessionCreateParams {
  /** One recurring product starts a subscription; one-time items take a payment. */
  product_cart: ProductCartItem[];
  customer?: { email?: string; name?: string; phone_number?: string };
  /** Where the customer lands afterwards, with payment_id, status and session_id appended. */
  return_url?: string;
  metadata?: Metadata;
}

export type PaymentStatus =
  | "processing"
  | "succeeded"
  | "failed"
  | "refunded"
  | "partially_refunded";
export interface Payment {
  object: "payment";
  payment_id: string;
  status: PaymentStatus;
  total_amount: number;
  refunded_amount: number;
  /** Utopia's processing fee, kept after a refund. Null while processing or failed. */
  fee_amount: number | null;
  /** total_amount − refunded_amount − fee_amount; below zero after a full refund. Null while processing or failed. */
  net_amount: number | null;
  currency: Currency;
  description: string;
  customer: {
    customer_id: string | null;
    name: string | null;
    email: string | null;
    phone_number: string | null;
  };
  checkout_session_id: string | null;
  subscription_id: string | null;
  billing_reason: "payment" | "subscription_create" | "subscription_cycle";
  metadata: Metadata;
  livemode: boolean;
  created_at: string;
  paid_at: string | null;
}
export interface PaymentListParams extends ListParams {
  status?: PaymentStatus;
  customer_id?: string;
  checkout_session_id?: string;
}

export type SubscriptionStatus = "active" | "on_hold" | "cancelled";
export interface Subscription {
  object: "subscription";
  subscription_id: string;
  status: SubscriptionStatus;
  product_id: string;
  name: string;
  quantity: number;
  recurring_amount: number;
  currency: Currency;
  billing_interval: BillingInterval;
  interval_count: number;
  customer: { customer_id: string | null; name: string | null; email: string };
  payment_method: {
    brand: string | null;
    last4: string;
    exp_month: number | null;
    exp_year: number | null;
  } | null;
  current_period_start: string;
  next_billing_date: string;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  cancellation_reason:
    | "requested"
    | "payment_failed"
    | "gateway_canceled"
    | "merchant_rejected"
    | null;
  failed_payment_attempts: number;
  next_retry_at: string | null;
  checkout_session_id: string | null;
  metadata: Metadata;
  livemode: boolean;
  created_at: string;
}
export interface SubscriptionListParams extends ListParams {
  status?: SubscriptionStatus;
  customer_id?: string;
}
export interface SubscriptionUpdateParams {
  cancel_at_period_end?: boolean;
  status?: "cancelled";
  metadata?: Metadata;
}

export type EventType =
  | "payment.succeeded"
  | "payment.failed"
  | "refund.succeeded"
  | "subscription.active"
  | "subscription.renewed"
  | "subscription.on_hold"
  | "subscription.cancelled";
export interface WebhookEndpoint {
  object: "webhook";
  webhook_id: string;
  url: string;
  description: string;
  /** Empty means every event type. */
  event_types: EventType[];
  disabled: boolean;
  livemode: boolean;
  created_at: string;
}
export interface WebhookEndpointCreateParams {
  url: string;
  description?: string;
  event_types?: EventType[];
  disabled?: boolean;
}
export type WebhookEndpointUpdateParams = Partial<WebhookEndpointCreateParams>;

interface EventBase<T extends string, D> {
  id: string;
  type: T;
  livemode: boolean;
  created_at: string;
  data: D;
}
/** The body of a webhook delivery. */
export type WebhookEvent =
  | EventBase<"payment.succeeded" | "payment.failed", Payment>
  | EventBase<"refund.succeeded", Payment & { refund_amount: number }>
  | EventBase<
      | "subscription.active"
      | "subscription.renewed"
      | "subscription.on_hold"
      | "subscription.cancelled",
      Subscription
    >
  | EventBase<"webhook.test", { message: string }>;
export interface Event {
  object: "event";
  event_id: string;
  type: EventType | "webhook.test";
  livemode: boolean;
  created_at: string;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UtopiaError extends Error {
  /** Machine-readable code from the API, like NOT_FOUND or CURRENCY_NOT_SUPPORTED. */
  readonly code: string;
  readonly status: number | undefined;
  readonly headers: Headers | undefined;
  constructor(
    message: string,
    options: { code: string; status?: number; headers?: Headers; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.status = options.status;
    this.headers = options.headers;
  }
}
export class InvalidRequestError extends UtopiaError {}
export class AuthenticationError extends UtopiaError {}
export class PermissionDeniedError extends UtopiaError {}
export class NotFoundError extends UtopiaError {}
export class ConflictError extends UtopiaError {}
export class RateLimitError extends UtopiaError {}
export class APIError extends UtopiaError {}
export class APIConnectionError extends UtopiaError {}
export class WebhookVerificationError extends UtopiaError {}

function errorFor(status: number, body: unknown, headers: Headers): UtopiaError {
  const data = (body ?? {}) as { code?: string; message?: string };
  const options = { code: data.code ?? "HTTP_" + status, status, headers };
  const message = data.message ?? `Request failed with status ${status}`;
  if (status === 401) return new AuthenticationError(message, options);
  if (status === 403) return new PermissionDeniedError(message, options);
  if (status === 404) return new NotFoundError(message, options);
  if (status === 409) return new ConflictError(message, options);
  if (status === 429) return new RateLimitError(message, options);
  if (status >= 500) return new APIError(message, options);
  return new InvalidRequestError(message, options);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface UtopiaOptions {
  /** Secret key (sk_live_… or sk_test_…). Defaults to process.env.UTOPIA_API_KEY. */
  apiKey?: string;
  /** Must use https://, except for localhost. Default https://utopia-payments.com/api/v1. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30 seconds. */
  timeout?: number;
  /** Retries for network errors, 429 and 5xx responses. Default 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
}
export interface RequestOptions {
  /** Reuse the same key to retry a create safely. One is generated if omitted. */
  idempotencyKey?: string;
  timeout?: number;
  signal?: AbortSignal;
}
interface RawRequest extends RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (attempt: number) =>
  Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

// The key travels in a header, so the API is only ever called over TLS. Plain
// http is allowed for a sandbox on this machine alone.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
function secureBaseUrl(baseUrl: string): string {
  const url = URL.canParse(baseUrl) ? new URL(baseUrl) : undefined;
  if (!url) throw new UtopiaError("baseUrl is not a valid URL.", { code: "INVALID_BASE_URL" });
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)))
    throw new UtopiaError("baseUrl must use https:// (http:// is only allowed for localhost).", {
      code: "INVALID_BASE_URL",
    });
  return baseUrl.replace(/\/+$/, "");
}

/** A page that can be awaited, or iterated to walk every page in turn. */
export class PagePromise<T> implements PromiseLike<Page<T>>, AsyncIterable<T> {
  constructor(private readonly load: (cursor?: string) => Promise<Page<T>>) {}
  then<A = Page<T>, B = never>(
    onfulfilled?: ((value: Page<T>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.load().then(onfulfilled, onrejected);
  }
  catch<B = never>(
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<Page<T> | B> {
    return this.load().catch(onrejected);
  }
  finally(onfinally?: (() => void) | null): Promise<Page<T>> {
    return this.load().finally(onfinally);
  }
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let cursor: string | undefined;
    do {
      const page = await this.load(cursor);
      yield* page.items;
      cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
    } while (cursor);
  }
}

export class Utopia {
  readonly account: AccountResource;
  readonly products: ProductsResource;
  readonly customers: CustomersResource;
  readonly checkoutSessions: CheckoutSessionsResource;
  readonly payments: PaymentsResource;
  readonly subscriptions: SubscriptionsResource;
  readonly webhookEndpoints: WebhookEndpointsResource;
  readonly events: EventsResource;
  /** Verifies webhook deliveries. Needs no API key. */
  readonly webhooks = new Webhooks();

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeout: number;
  readonly #maxRetries: number;
  readonly #fetch: typeof fetch;

  constructor(options: UtopiaOptions = {}) {
    const apiKey =
      options.apiKey ??
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.UTOPIA_API_KEY;
    if (!apiKey || !/^sk_(live|test)_/.test(apiKey))
      throw new UtopiaError(
        "Pass your secret API key ({ apiKey: 'sk_live_…' }) or set UTOPIA_API_KEY.",
        { code: "MISSING_API_KEY" },
      );
    this.#apiKey = apiKey;
    this.#baseUrl = secureBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#timeout = options.timeout ?? 30_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.account = new AccountResource(this);
    this.products = new ProductsResource(this);
    this.customers = new CustomersResource(this);
    this.checkoutSessions = new CheckoutSessionsResource(this);
    this.payments = new PaymentsResource(this);
    this.subscriptions = new SubscriptionsResource(this);
    this.webhookEndpoints = new WebhookEndpointsResource(this);
    this.events = new EventsResource(this);
  }

  /** True for live keys, false for test keys. */
  get livemode(): boolean {
    return this.#apiKey.startsWith("sk_live_");
  }

  async request<T>(method: string, path: string, options: RawRequest = {}): Promise<T> {
    const url = new URL(this.#baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {}))
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "User-Agent": `utopia-node/${VERSION}`,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    // Every create carries an idempotency key, so a retry can never duplicate it.
    if (method === "POST") headers["Idempotency-Key"] = options.idempotencyKey ?? randomUUID();

    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(options.timeout ?? this.#timeout);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await this.#fetch(url, { method, headers, body, signal });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (attempt < this.#maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new APIConnectionError(
          `Could not reach the Utopia API: ${(error as Error).message}`,
          { code: "CONNECTION_ERROR", cause: error },
        );
      }
      if (response.ok) return (await response.json()) as T;
      const data = await response.json().catch(() => null);
      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        (data as { code?: string } | null)?.code === "IDEMPOTENCY_KEY_IN_USE";
      if (retryable && attempt < this.#maxRetries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 20_000) : backoff(attempt));
        continue;
      }
      throw errorFor(response.status, data, response.headers);
    }
  }

  /** @internal */
  list<T>(path: string, params: object = {}, options?: RequestOptions): PagePromise<T> {
    return new PagePromise<T>((cursor) =>
      this.request<Page<T>>("GET", path, {
        ...options,
        query: { ...(params as RawRequest["query"]), ...(cursor ? { cursor } : {}) },
      }),
    );
  }
}

const segment = (id: string) => encodeURIComponent(id);

class AccountResource {
  constructor(private readonly client: Utopia) {}
  retrieve(options?: RequestOptions) {
    return this.client.request<Account>("GET", "/account", options);
  }
}

class ProductsResource {
  constructor(private readonly client: Utopia) {}
  create(params: ProductCreateParams, options?: RequestOptions) {
    return this.client.request<Product>("POST", "/products", { ...options, body: params });
  }
  retrieve(id: string, options?: RequestOptions) {
    return this.client.request<Product>("GET", `/products/${segment(id)}`, options);
  }
  update(id: string, params: ProductUpdateParams, options?: RequestOptions) {
    return this.client.request<Product>("PATCH", `/products/${segment(id)}`, {
      ...options,
      body: params,
    });
  }
  list(params?: ProductListParams, options?: RequestOptions) {
    return this.client.list<Product>("/products", params, options);
  }
}

class CustomersResource {
  constructor(private readonly client: Utopia) {}
  create(params: CustomerCreateParams, options?: RequestOptions) {
    return this.client.request<Customer>("POST", "/customers", { ...options, body: params });
  }
  retrieve(id: string, options?: RequestOptions) {
    return this.client.request<Customer>("GET", `/customers/${segment(id)}`, options);
  }
  update(id: string, params: CustomerUpdateParams, options?: RequestOptions) {
    return this.client.request<Customer>("PATCH", `/customers/${segment(id)}`, {
      ...options,
      body: params,
    });
  }
  list(params?: CustomerListParams, options?: RequestOptions) {
    return this.client.list<Customer>("/customers", params, options);
  }
}

class CheckoutSessionsResource {
  constructor(private readonly client: Utopia) {}
  /** Creates a hosted checkout. Redirect the customer to `checkout_url`. */
  create(params: CheckoutSessionCreateParams, options?: RequestOptions) {
    return this.client.request<CheckoutSession>("POST", "/checkout_sessions", {
      ...options,
      body: params,
    });
  }
  retrieve(id: string, options?: RequestOptions) {
    return this.client.request<CheckoutSession>(
      "GET",
      `/checkout_sessions/${segment(id)}`,
      options,
    );
  }
}

class PaymentsResource {
  constructor(private readonly client: Utopia) {}
  retrieve(id: string, options?: RequestOptions) {
    return this.client.request<Payment>("GET", `/payments/${segment(id)}`, options);
  }
  list(params?: PaymentListParams, options?: RequestOptions) {
    return this.client.list<Payment>("/payments", params, options);
  }
}

class SubscriptionsResource {
  constructor(private readonly client: Utopia) {}
  retrieve(id: string, options?: RequestOptions) {
    return this.client.request<Subscription>("GET", `/subscriptions/${segment(id)}`, options);
  }
  list(params?: SubscriptionListParams, options?: RequestOptions) {
    return this.client.list<Subscription>("/subscriptions", params, options);
  }
  update(id: string, params: SubscriptionUpdateParams, options?: RequestOptions) {
    return this.client.request<Subscription>("PATCH", `/subscriptions/${segment(id)}`, {
      ...options,
      body: params,
    });
  }
  /** Cancels now, or at the end of the paid period with `{ atPeriodEnd: true }`. */
  cancel(id: string, { atPeriodEnd = false }: { atPeriodEnd?: boolean } = {}, options?: RequestOptions) {
    return this.update(
      id,
      atPeriodEnd ? { cancel_at_period_end: true } : { status: "cancelled" },
      options,
    );
  }
}

class WebhookEndpointsResource {
  constructor(private readonly client: Utopia) {}
  /** The response includes `secret`, used to verify deliveries. */
  create(params: WebhookEndpointCreateParams, options?: RequestOptions) {
    return this.client.request<WebhookEndpoint & { secret: string }>("POST", "/webhooks", {
      ...options,
      body: params,
    });
  }
  retrieve(id: string, options?: RequestOptions) {
    return this.client.request<WebhookEndpoint>("GET", `/webhooks/${segment(id)}`, options);
  }
  update(id: string, params: WebhookEndpointUpdateParams, options?: RequestOptions) {
    return this.client.request<WebhookEndpoint>("PATCH", `/webhooks/${segment(id)}`, {
      ...options,
      body: params,
    });
  }
  delete(id: string, options?: RequestOptions) {
    return this.client.request<{ object: "webhook"; webhook_id: string; deleted: true }>(
      "DELETE",
      `/webhooks/${segment(id)}`,
      options,
    );
  }
  list(options?: RequestOptions) {
    return this.client.request<Page<WebhookEndpoint>>("GET", "/webhooks", options);
  }
  secret(id: string, options?: RequestOptions) {
    return this.client.request<{ secret: string }>(
      "GET",
      `/webhooks/${segment(id)}/secret`,
      options,
    );
  }
}

class EventsResource {
  constructor(private readonly client: Utopia) {}
  retrieve(id: string, options?: RequestOptions) {
    return this.client.request<Event>("GET", `/events/${segment(id)}`, options);
  }
  list(params?: ListParams & { type?: string }, options?: RequestOptions) {
    return this.client.list<Event>("/events", params, options);
  }
}

// ---------------------------------------------------------------------------
// Webhook verification (Standard Webhooks)
// ---------------------------------------------------------------------------

type HeaderBag = Headers | Record<string, string | string[] | undefined>;
// Strict base64: the alphabet only, in whole groups, padded. Buffer.from()
// alone would quietly turn junk into a short or empty key.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class Webhooks {
  /**
   * Verifies a delivery and returns its event. Pass the raw request body
   * exactly as received: a re-serialised JSON object will not verify.
   */
  unwrap(
    payload: string | Uint8Array,
    headers: HeaderBag,
    secret: string,
    { tolerance = 300 }: { tolerance?: number } = {},
  ): WebhookEvent {
    const read = (name: string) =>
      headers instanceof Headers ? headers.get(name) : [headers[name]].flat()[0];
    const id = read("webhook-id");
    const timestamp = read("webhook-timestamp");
    const signatures = read("webhook-signature");
    const fail = (message: string) =>
      new WebhookVerificationError(message, { code: "WEBHOOK_VERIFICATION_FAILED" });
    // An empty or malformed secret would key the HMAC with nothing, and a
    // forged signature could then verify.
    const encoded = typeof secret === "string" ? secret.replace(/^whsec_/, "") : "";
    const key = BASE64.test(encoded) ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
    if (key.length === 0) throw fail("The webhook secret is not a valid whsec_ secret");
    if (!id || !timestamp || !signatures)
      throw fail("Missing webhook-id, webhook-timestamp or webhook-signature header");
    const seconds = Number(timestamp);
    if (!Number.isInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > tolerance)
      throw fail("The webhook timestamp is too old or too far in the future");
    const body = typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8");
    const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
    const valid = signatures.split(" ").some((entry) => {
      const [version, value] = entry.split(",");
      if (version !== "v1" || !value) return false;
      const received = Buffer.from(value, "base64");
      return received.length === expected.length && timingSafeEqual(received, expected);
    });
    if (!valid) throw fail("The webhook signature does not match");
    return JSON.parse(body) as WebhookEvent;
  }
}

export default Utopia;
