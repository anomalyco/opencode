export function createWebApp(domain: string) {
  return new sst.cloudflare.StaticSite("WebApp", {
    domain,
    path: "packages/app",
    environment:
      $app.stage === "beta"
        ? {
            OPENCODE_CHANNEL: "beta",
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
