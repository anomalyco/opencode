import { expect, test } from "bun:test"
import { Stripe } from "stripe"

test("Billing.stripe memoizes the configured Stripe client", async () => {
  const app = process.env.SST_RESOURCE_App
  const secret = process.env.SST_RESOURCE_STRIPE_SECRET_KEY
  const litePrice = process.env.SST_RESOURCE_ZEN_LITE_PRICE
  process.env.SST_RESOURCE_App = JSON.stringify({ name: "test", stage: "test" })
  process.env.SST_RESOURCE_STRIPE_SECRET_KEY = JSON.stringify({ value: "sk_test_billing" })
  process.env.SST_RESOURCE_ZEN_LITE_PRICE = JSON.stringify({})

  try {
    const { Billing } = await import("../src/billing")
    const client = Billing.stripe()

    expect(client).toBe(Billing.stripe())
    expect(client).toBeInstanceOf(Stripe)
    expect(client).toHaveProperty("_authenticator._apiKey", "sk_test_billing")
    expect(client).toHaveProperty("_api.version", "2025-03-31.basil")
    expect(client).toHaveProperty("_api.httpClient._fetchFn")
  } finally {
    if (app === undefined) delete process.env.SST_RESOURCE_App
    else process.env.SST_RESOURCE_App = app
    if (secret === undefined) delete process.env.SST_RESOURCE_STRIPE_SECRET_KEY
    else process.env.SST_RESOURCE_STRIPE_SECRET_KEY = secret
    if (litePrice === undefined) delete process.env.SST_RESOURCE_ZEN_LITE_PRICE
    else process.env.SST_RESOURCE_ZEN_LITE_PRICE = litePrice
  }
})
