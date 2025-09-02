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
          apiKey: process.env.STRIPE_SECRET_KEY,
        },
        planetscale: "0.4.1",
      },
    };
  },
  async run() {
    const { api } = await import("./infra/app.js");
    const { auth, gateway } = await import("./infra/cloud.js");
    return {
      api: api.url,
      gateway: gateway.url,
      auth: auth.url,
    };
  },
});
