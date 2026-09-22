# Utopia Payments for Node.js

The official Node.js and TypeScript library for the
[Utopia Payments API](https://utopia-payments.com/docs/): hosted checkout,
subscriptions with automatic renewals, and signed webhooks.

- Zero dependencies, ESM and CommonJS, full TypeScript types
- Every create sends an `Idempotency-Key`, so retries never double-charge
- Network errors, `429` and `5xx` are retried with backoff
- Lists paginate automatically with `for await`
- `webhooks.unwrap()` verifies [Standard Webhooks](https://standardwebhooks.com) signatures

Requires Node.js 20.3 or later.

## Install

```bash
npm install @utopia-payments/node
```

Source and releases are published from
[`Utopia-Payments/utopia-node`](https://github.com/Utopia-Payments/utopia-node).

## Quick start

Create a secret key in **Dashboard → Developers** and keep it on your server
(for example in `UTOPIA_API_KEY`).

```ts
import Utopia from "@utopia-payments/node";

const utopia = new Utopia({ apiKey: process.env.UTOPIA_API_KEY });

// One-time payment: send the customer to the hosted checkout.
const session = await utopia.checkoutSessions.create({
  product_cart: [{ product_id: "pdt_…", quantity: 1 }],
  customer: { email: "customer@example.com" },
  return_url: "https://your-store.com/thank-you",
  metadata: { order_id: "1001" },
});
redirect(session.checkout_url);
```

Amounts are integer minor units: `34900` is AED 349.00.

After paying, the customer returns to `return_url` with `payment_id`,
`status` and `session_id` appended. Treat that as a hint only, and fulfil
orders from the `payment.succeeded` webhook.

### Carts without saved products

```ts
await utopia.checkoutSessions.create({
  product_cart: [{ name: "Order #1001", unit_amount: 12550, currency: "AED", quantity: 2 }],
  return_url: "https://your-store.com/orders/1001",
});
```

## Subscriptions

Create a recurring product once, then check out with it. The first payment
saves the card and renewals are charged automatically.

```ts
const plan = await utopia.products.create({
  name: "Pro",
  price: 9900,
  currency: "AED",
  billing: "recurring",
  billing_interval: "month",
});

const session = await utopia.checkoutSessions.create({
  product_cart: [{ product_id: plan.product_id }],
  customer: { email: "member@example.com" },
  return_url: "https://your-app.com/billing",
});

// Later
await utopia.subscriptions.cancel("sub_…", { atPeriodEnd: true });
```

If a renewal is declined, the subscription goes `on_hold`. The customer is
emailed a payment link, and retries follow after 1, 3 and 5 days. Listen for
`subscription.renewed`, `subscription.on_hold` and `subscription.cancelled`.

## Webhooks

Add an endpoint in **Dashboard → Developers** (or with
`utopia.webhookEndpoints.create`) and store its `whsec_…` secret. Verify
every delivery against the **raw** request body:

```ts
// Express
app.post("/webhooks/utopia", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = utopia.webhooks.unwrap(req.body, req.headers, process.env.UTOPIA_WEBHOOK_SECRET);
  } catch {
    return res.sendStatus(400);
  }
  if (event.type === "payment.succeeded") fulfil(event.data.metadata.order_id);
  res.sendStatus(204);
});
```

```ts
// Next.js route handler
export async function POST(request: Request) {
  const event = utopia.webhooks.unwrap(
    await request.text(),
    request.headers,
    process.env.UTOPIA_WEBHOOK_SECRET!,
  );
  // …
  return new Response(null, { status: 204 });
}
```

Deliveries retry for about a day if you don't answer with a 2xx. Use
`event.id` (the `webhook-id` header) to ignore duplicates.

## Pagination

```ts
const page = await utopia.payments.list({ limit: 50, status: "succeeded" });

for await (const payment of utopia.payments.list({ limit: 100 })) {
  console.log(payment.payment_id, payment.total_amount);
}
```

## Errors

```ts
import { NotFoundError, InvalidRequestError, UtopiaError } from "@utopia-payments/node";

try {
  await utopia.payments.retrieve("pay_…");
} catch (error) {
  if (error instanceof NotFoundError) {
    // …
  } else if (error instanceof UtopiaError) {
    console.log(error.status, error.code, error.message);
  }
}
```

Error classes: `InvalidRequestError`, `AuthenticationError`,
`PermissionDeniedError`, `NotFoundError`, `ConflictError`, `RateLimitError`,
`APIError`, `APIConnectionError`, `WebhookVerificationError`.

## Test mode

Test keys (`sk_test_…`) keep their own payments, subscriptions, webhooks and
events. `utopia.livemode` tells you which kind of key a client uses.

## Options

```ts
new Utopia({
  apiKey: "sk_live_…",
  timeout: 30_000, // ms per request
  maxRetries: 2,
  baseUrl: "https://utopia-payments.com/api/v1",
});
```
