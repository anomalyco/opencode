import { domain } from "./stage"

new sst.cloudflare.StaticSite("Desktop", {
  domain: "desktop." + domain,
  path: "packages/desktop",
  build: {
    command: "bun turbo build",
    output: "./dist",
  },
})
