/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    const deployAws = input.stage === "production" || input.stage === "dev" || input.stage === "adam"
    return {
      name: "opencode",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: {
        ...(deployAws
          ? {
              aws: {
                version: "7.30.0",
                region: "us-east-1",
                profile: process.env.GITHUB_ACTIONS
                  ? undefined
                  : input.stage === "production"
                    ? "opencode-production"
                    : "opencode-dev",
              },
            }
          : {}),
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
    if (stage.deployAws) {
      await import("./infra/lake.js")
      await import("./infra/stats.js")
    }
    const { stat } = await import("./infra/console.js")
    await import("./infra/enterprise.js")
    if ($app.stage === "production" || $app.stage === "vimtor") {
      await import("./infra/monitoring.js")
    }

    return {
      StatWorkerUrl: stat.url,
      // StatsUrl: stats.app.url,
      ...(stage.githubActionsDeployRoleArn ? { GithubActionsDeployRoleArn: stage.githubActionsDeployRoleArn } : {}),
    }
  },
})
