import { domain } from "./stage"

new sst.cloudflare.StaticSite("Desktop", {
  domain: "desktop." + domain,
  path: "packages/app/public",
})
