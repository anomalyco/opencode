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

const web = new sst.cloudflare.x.Astro("Web", {
  domain: "docs." + domain,
  path: "packages/web",
  environment: {
    // For astro config
    SST_STAGE: $app.stage,
    VITE_API_URL: api.url.apply((url) => url!),
  },
})

// The site serves itself under /docs, so this route takes /docs on the main host. An exact `/docs` pattern misses
// `/docs?query`, so it's a `/docs*` prefix. `sst dev` deploys no Worker.
const webServer = web.nodes.server
if (webServer) {
  new cloudflare.WorkersRoute("WebDocsRoute", {
    zoneId: zoneID,
    pattern: `${domain}/docs*`,
    script: webServer.nodes.worker.scriptName,
  })
}
