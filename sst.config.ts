/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "opencode",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: {
        stripe: {
          apiKey: process.env.STRIPE_SECRET_KEY!,
        },
        planetscale: "0.4.1",
        honeycomb: {
          version: "0.49.0",
          apiKey: process.env.HONEYCOMB_API_KEY!,
        },
        incident: {
          version: "5.35.0",
          apiKey: process.env.INCIDENT_API_KEY!,
        },
      },
    }
  },
  async run() {
    await import("./infra/app.js")
    await import("./infra/console.js")
    await import("./infra/enterprise.js")
    if ($app.stage === "production") {
      await import("./infra/monitoring.js")
    }
  },
})
