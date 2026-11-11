import { bindings, defineConfig } from "cf/config"

// Deprecated: what is left of V1's hosted services, deployed on its own instead of through SST. Don't add features
// here; delete a hostname once old links and V1 clients no longer need an answer from it.
// - opncd.ai: the retired session-sharing host. Session sharing is retired and V2 has no sharing, so it only answers
//   the tombstone page and the V1 share API stubs.
// - api.opencode.ai: the GitHub App token exchange used by the V1 GitHub Action.
export default defineConfig(({ mode }) => {
  const dev = mode === "dev"
  return {
    // Anomaly
    accountId: dev ? "d8e944f537ceef3f06a5bd3aec1d7a53" : "15d29c8639fd3733b1b5486a2acfd968",
    worker: {
      name: dev ? "opencode-legacy-dev" : "opencode-legacy-production",
      compatibilityDate: "2026-07-25",
      // @octokit/auth-app signs the GitHub App JWT with node:crypto.
      compatibilityFlags: ["nodejs_compat"],
      entrypoint: "./src/index.ts",
      domains: dev ? ["dev.opncd.ai", "api.dev.opencode.ai"] : ["opncd.ai", "api.opencode.ai"],
      // Set from AWS Secrets Manager (opencode/<stage>/GITHUB_APP_*) by the deploy job with --secrets-file.
      env: {
        GITHUB_APP_ID: bindings.secret(),
        GITHUB_APP_PRIVATE_KEY: bindings.secret(),
      },
      workersDev: false,
      previewUrls: false,
      logpush: !dev,
      observability: { enabled: true },
    },
  }
})
