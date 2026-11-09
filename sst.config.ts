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
    const stats = stage.deployStats ? await import("./infra/stats.js") : undefined

    return {
      ...(stats ? { StatsUrl: stats.publicUrl } : {}),
      AwsStage: stage.awsStage,
    }
  },
})
