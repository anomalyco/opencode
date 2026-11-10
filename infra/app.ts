import { domain, zoneID } from "./stage"

const GITHUB_APP_ID = new sst.Secret("GITHUB_APP_ID")
const GITHUB_APP_PRIVATE_KEY = new sst.Secret("GITHUB_APP_PRIVATE_KEY")
const ADMIN_SECRET = new sst.Secret("ADMIN_SECRET")

export const api = new sst.cloudflare.Worker("Api", {
  domain: `api.${domain}`,
  handler: "packages/function/src/api.ts",
  url: true,
  link: [GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ADMIN_SECRET],
  transform: {
    worker: (args) => {
      args.logpush = true
    },
  },
})

// docs.opencode.ai and docs.dev.opencode.ai belong to the site Worker (services/site), which sends the old docs
// URLs there to the same path on the V1 docs at /v1/docs. Their custom domain was the V1 docs app's and is moved to
// the site Worker by hand in place, keeping its ID: every input of a custom domain forces a replacement, which would
// create the same ID and then delete it. DocsDomain adopts that resource so SST never deletes the live hostname: it
// is retained on delete, and its inputs are ignored so it is never updated or replaced.
if ($app.stage === "production" || $app.stage === "dev") {
  new cloudflare.WorkersCustomDomain(
    "DocsDomain",
    {
      accountId: "15d29c8639fd3733b1b5486a2acfd968",
      hostname: `docs.${domain}`,
      service: `opencode-site-${$app.stage}`,
      zoneId: zoneID,
      environment: "production",
    },
    {
      aliases: [
        `urn:pulumi:${$app.stage}::${$app.name}::sst:cloudflare:Astro$sst:cloudflare:Worker$cloudflare:index/workersCustomDomain:WorkersCustomDomain::WebWorkerDomain`,
      ],
      retainOnDelete: true,
      ignoreChanges: ["accountId", "hostname", "service", "zoneId", "environment"],
    },
  )
}
