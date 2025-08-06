/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "opencode",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
    }
  },
  async run() {
    const { api, gateway } = await import("./infra/app.js")
    return {
      api: api.url,
      gateway: gateway.url,
    }
  },
})
