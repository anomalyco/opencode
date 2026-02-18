/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "opencode",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: {},
    }
  },
  async run() {
    await import("./infra/app.js")
    // await import("./infra/console.js")
    await import("./infra/enterprise.js")
  },
})
