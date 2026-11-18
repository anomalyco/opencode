import { sentryVitePlugin } from "@sentry/vite-plugin"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
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

// `VITE_BASE_URL=/opencode` builds the app to be served under that path; it is the root by default.
const base = `/${(process.env.VITE_BASE_URL ?? "").replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/")

export default defineConfig({
  base,
  plugins: [
    desktopPlugin,
    icons(channel, base),
    serviceWorker(fileURLToPath(new URL("./dist", import.meta.url)), base),
    sentry,
  ] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    ...(process.env.VITE_OPENCODE_TEST_FIXTURES === "1"
      ? {
          rolldownOptions: {
            input: [
              "index.html",
              "e2e/utils/settings-wsl.html",
              "e2e/utils/app-direction.html",
              "e2e/utils/windows-menu.html",
            ],
          },
        }
      : {}),
    assetsDir: "_assets",
    target: "esnext",
    sourcemap: true,
  },
})
