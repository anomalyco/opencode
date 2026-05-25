import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

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
  plugins: [desktopPlugin, sentry] as any,
  server: {
    // FORK: R6 loopback-only — 默认 0.0.0.0 暴露 dev server 到 LAN 是安全风险 2026-05-25
    host: "127.0.0.1",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
