/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "opencode",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: {
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
        random: "4.19.2",
        planetscale: "0.4.1",
        honeycomb: "0.49.0",
      },
    }
  },
  async run() {
    const stage = await import("./infra/stage.js")
    await import("./infra/app.js")
    const stats = stage.deployAws ? await import("./infra/lake.js").then(() => import("./infra/stats.js")) : undefined
    const { stat } = await import("./infra/console.js")
    await import("./infra/enterprise.js")
    if ($app.stage === "production" || $app.stage === "vimtor") {
      await import("./infra/monitoring.js")
    }

    return {
      StatWorkerUrl: stat.url,
      ...(stats ? { StatsUrl: stats.app.url } : {}),
      AwsStage: stage.awsStage,
    }
  },
})
