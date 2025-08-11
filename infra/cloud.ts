import { WebhookEndpoint } from "pulumi-stripe"
import { domain } from "./stage"
import { web } from "./app"

////////////////
// DATABASE
////////////////

const DATABASE_USERNAME = new sst.Secret("DATABASE_USERNAME")
const DATABASE_PASSWORD = new sst.Secret("DATABASE_PASSWORD")
export const database = new sst.Linkable("Database", {
  properties: {
    host: "aws-us-east-2-1.pg.psdb.cloud",
    database: "postgres",
    username: DATABASE_USERNAME.value,
    password: DATABASE_PASSWORD.value,
    port: 5432,
  },
})

new sst.x.DevCommand("Studio", {
  link: [database],
  dev: {
    command: "bun db studio",
    directory: "cloud/core",
    autostart: true,
  },
})

////////////////
// AUTH
////////////////

const GITHUB_CLIENT_ID_CONSOLE = new sst.Secret("GITHUB_CLIENT_ID_CONSOLE")
const GITHUB_CLIENT_SECRET_CONSOLE = new sst.Secret("GITHUB_CLIENT_SECRET_CONSOLE")
const GOOGLE_CLIENT_ID = new sst.Secret("GOOGLE_CLIENT_ID")
const authStorage = new sst.cloudflare.Kv("AuthStorage")
export const auth = new sst.cloudflare.Worker("AuthApi", {
  domain: `auth.${domain}`,
  handler: "cloud/function/src/auth.ts",
  url: true,
  link: [database, authStorage, GITHUB_CLIENT_ID_CONSOLE, GITHUB_CLIENT_SECRET_CONSOLE, GOOGLE_CLIENT_ID],
})

////////////////
// GATEWAY
////////////////

export const stripeWebhook = new WebhookEndpoint("StripeWebhook", {
  url: $interpolate`https://api.gateway.${domain}/stripe/webhook`,
  enabledEvents: [
    "checkout.session.async_payment_failed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.completed",
    "checkout.session.expired",
    "customer.created",
    "customer.deleted",
    "customer.updated",
    "customer.discount.created",
    "customer.discount.deleted",
    "customer.discount.updated",
    "customer.source.created",
    "customer.source.deleted",
    "customer.source.expiring",
    "customer.source.updated",
    "customer.subscription.created",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.pending_update_applied",
    "customer.subscription.pending_update_expired",
    "customer.subscription.resumed",
    "customer.subscription.trial_will_end",
    "customer.subscription.updated",
    "customer.tax_id.created",
    "customer.tax_id.deleted",
    "customer.tax_id.updated",
  ],
})

const ANTHROPIC_API_KEY = new sst.Secret("ANTHROPIC_API_KEY")
const OPENAI_API_KEY = new sst.Secret("OPENAI_API_KEY")
const ZHIPU_API_KEY = new sst.Secret("ZHIPU_API_KEY")
const STRIPE_SECRET_KEY = new sst.Secret("STRIPE_SECRET_KEY")
const AUTH_API_URL = new sst.Linkable("AUTH_API_URL", {
  properties: { value: auth.url.apply((url) => url!) },
})
const STRIPE_WEBHOOK_SECRET = new sst.Linkable("STRIPE_WEBHOOK_SECRET", {
  properties: { value: stripeWebhook.secret },
})
export const gateway = new sst.cloudflare.Worker("GatewayApi", {
  domain: `api.gateway.${domain}`,
  handler: "cloud/function/src/gateway.ts",
  url: true,
  link: [
    database,
    AUTH_API_URL,
    STRIPE_WEBHOOK_SECRET,
    STRIPE_SECRET_KEY,
    ANTHROPIC_API_KEY,
    OPENAI_API_KEY,
    ZHIPU_API_KEY,
  ],
})

////////////////
// CONSOLE
////////////////

export const console = new sst.cloudflare.x.StaticSite("Console", {
  domain: `console.${domain}`,
  path: "cloud/web",
  build: {
    command: "bun run build",
    output: "dist/client",
  },
  environment: {
    VITE_DOCS_URL: web.url.apply((url) => url!),
    VITE_API_URL: gateway.url.apply((url) => url!),
    VITE_AUTH_URL: auth.url.apply((url) => url!),
  },
})
