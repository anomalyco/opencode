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
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: {
      "/api": "http://127.0.0.1:4096",
      "/event": { target: "ws://127.0.0.1:4096", ws: true },
      "/global/event": { target: "ws://127.0.0.1:4096", ws: true },
      "/global/health": "http://127.0.0.1:4096",
      "/path": "http://127.0.0.1:4096",
      "/session": "http://127.0.0.1:4096",
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
