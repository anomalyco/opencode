export function createWebApp(domain: string) {
  // Workers Static Assets uploads files as-is, up to 25 MiB each. StaticSite stored them base64-encoded in KV, which
  // pushed the 20 MB Word preview engine past KV's 25 MiB value limit.
  return new sst.cloudflare.StaticSiteV2("WebApp", {
    domain,
    path: "packages/app",
    environment:
      $app.stage === "beta"
        ? {
            OPENCODE_CHANNEL: "beta",
            VITE_OPENCODE_SERVER_MODE: "none",
            VITE_SENTRY_ENVIRONMENT: "beta",
          }
        : undefined,
    build: {
      // Preserve Sentry credentials and run source-map uploads on every deployment.
      command: "bun run build",
      output: "./dist",
    },
  })
}
