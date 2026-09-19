import { sentryVitePlugin } from "@sentry/vite-plugin"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"
import desktopPlugin, { channel } from "./vite.js"
import { icons } from "./vite.icons"
import { serviceWorker } from "./vite.pwa"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

export default defineConfig({
  plugins: [
    desktopPlugin,
    icons(channel),
    {
      name: "opencode:nonempty-chunks",
      generateBundle(_, bundle) {
        // SST's KV router serves HTML for zero-byte chunks, failing precache integrity checks.
        Object.values(bundle).forEach((output) => {
          if (output.type === "chunk" && !output.code) output.code = ";"
        })
      },
    } satisfies Plugin,
    serviceWorker(fileURLToPath(new URL("./dist", import.meta.url))),
    sentry,
  ] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    ...(process.env.VITE_OPENCODE_TEST_FIXTURES === "1"
      ? { rolldownOptions: { input: ["index.html", "e2e/utils/settings-wsl.html", "e2e/utils/app-direction.html"] } }
      : {}),
    assetsDir: "_assets",
    target: "esnext",
    sourcemap: true,
  },
})
