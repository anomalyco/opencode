import { domain } from "./stage"
import { EMAILOCTOPUS_API_KEY } from "./app"

// Archived Zen request/response dumps (writer removed May 2026). Retained on purpose; nothing reads or writes them.
new sst.cloudflare.Bucket("ZenData")
new sst.cloudflare.Bucket("ZenDataNew")

const AWS_SES_ACCESS_KEY_ID = new sst.Secret("AWS_SES_ACCESS_KEY_ID")
const AWS_SES_SECRET_ACCESS_KEY = new sst.Secret("AWS_SES_SECRET_ACCESS_KEY")
const ENTERPRISE_SALES_INBOX_EMAIL = new sst.Secret("ENTERPRISE_SALES_INBOX_EMAIL")
// OpenCode API key for Jev spam scoring of enterprise form submissions.
const ENTERPRISE_SPAM_API_KEY = new sst.Secret("ENTERPRISE_SPAM_API_KEY")
// hCaptcha guards the enterprise form; the site key is public and baked into the client bundle.
const HCAPTCHA_SITE_KEY = new sst.Secret("HCAPTCHA_SITE_KEY")
const HCAPTCHA_SECRET_KEY = new sst.Secret("HCAPTCHA_SECRET_KEY")

const SALESFORCE_CLIENT_ID = new sst.Secret("SALESFORCE_CLIENT_ID")
const SALESFORCE_CLIENT_SECRET = new sst.Secret("SALESFORCE_CLIENT_SECRET")
const SALESFORCE_INSTANCE_URL = new sst.Secret("SALESFORCE_INSTANCE_URL")

new sst.cloudflare.x.SolidStart("Console", {
  domain,
  path: "packages/console/app",
  link: [
    EMAILOCTOPUS_API_KEY,
    AWS_SES_ACCESS_KEY_ID,
    AWS_SES_SECRET_ACCESS_KEY,
    ENTERPRISE_SALES_INBOX_EMAIL,
    ENTERPRISE_SPAM_API_KEY,
    HCAPTCHA_SECRET_KEY,
    SALESFORCE_CLIENT_ID,
    SALESFORCE_CLIENT_SECRET,
    SALESFORCE_INSTANCE_URL,
  ],
  environment: {
    //VITE_DOCS_URL: web.url.apply((url) => url!),
    //VITE_API_URL: gateway.url.apply((url) => url!),
    VITE_CONSOLE_MARKETING_ENABLED: $app.stage === "dev" ? "true" : "false",
    VITE_HCAPTCHA_SITE_KEY: HCAPTCHA_SITE_KEY.value,
  },
  transform: {
    server: {
      placement: { region: "aws:us-east-2" },
      transform: {
        worker: (args) => {
          args.compatibilityFlags = $resolve(args.compatibilityFlags).apply((flags) => [
            ...(flags ?? []),
            "global_fetch_strictly_public",
          ])
        },
      },
    },
  },
})
