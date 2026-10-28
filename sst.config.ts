/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "opencode",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers:
        input.stage === "beta"
          ? {}
          : {
              // Production state was written by 6.15.0; the default 6.13 provider can't read it back.
              cloudflare: "6.15.0",
              aws: {
                version: "7.30.0",
                region: "us-east-1",
                profile: process.env.GITHUB_ACTIONS
                  ? undefined
                  : input.stage === "production"
                    ? "opencode-production"
                    : "opencode-dev",
              },
              stripe: {
                version: "0.0.28",
                apiKey: process.env.STRIPE_SECRET_KEY!,
              },
              planetscale: "0.4.1",
            },
    }
  },
  async run() {
    if ($app.stage === "beta") {
      const { createWebApp } = await import("./infra/webapp.js")
      return { WebAppUrl: createWebApp("beta.opencode.ai").url }
    }

    const stage = await import("./infra/stage.js")
    await import("./infra/app.js")
    const stats = stage.deployAws ? await import("./infra/stats.js") : undefined
    await import("./infra/console.js")
    await import("./infra/share.js")

    return {
      ...(stats ? { StatsUrl: stats.app.url } : {}),
      AwsStage: stage.awsStage,
    }
  },
})
