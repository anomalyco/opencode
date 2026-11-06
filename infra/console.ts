import { domain, zoneID } from "./stage"
import { EMAILOCTOPUS_API_KEY } from "./app"

// opencode.ai and dev.opencode.ai belong to the site Worker (services/site) now, so the old Console Worker gets
// no custom domain there. Its custom domain was moved to the site Worker in place, keeping its ID (Cloudflare
// won't let a placeholder DNS record sit beside a Worker-managed one, and deleting the record first would leave
// the apex without DNS). SiteDomain adopts that resource so SST stops managing it without deleting the live
// hostname: it is retained on delete, and its inputs are ignored so it is never updated or replaced.
const siteOwnsDomain = $app.stage === "production" || $app.stage === "dev"
if (siteOwnsDomain) {
  new cloudflare.WorkersCustomDomain(
    "SiteDomain",
    {
      accountId: "15d29c8639fd3733b1b5486a2acfd968",
      hostname: domain,
      service: `opencode-site-${$app.stage}`,
      zoneId: zoneID,
      environment: "production",
    },
    {
      aliases: [
        `urn:pulumi:${$app.stage}::${$app.name}::sst:cloudflare:SolidStart$sst:cloudflare:Worker$cloudflare:index/workersCustomDomain:WorkersCustomDomain::ConsoleWorkerDomain`,
      ],
      retainOnDelete: true,
      ignoreChanges: ["accountId", "hostname", "service", "zoneId", "environment"],
    },
  )
}

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
  domain: siteOwnsDomain ? undefined : domain,
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
