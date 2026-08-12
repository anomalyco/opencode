import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import fs from "node:fs"
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
    https:
      process.env.VITE_HTTPS_CERT && process.env.VITE_HTTPS_KEY
        ? {
            cert: fs.readFileSync(process.env.VITE_HTTPS_CERT),
            key: fs.readFileSync(process.env.VITE_HTTPS_KEY),
          }
        : undefined,
    proxy: process.env.VITE_OPENCODE_PROXY_TARGET
      ? {
          "^/(api|experimental|global|event|session|project|config|file|permission|provider|command|mcp|agent|path|tui|pty|question|find|log|sync|auth|workspace|location)": {
            target: process.env.VITE_OPENCODE_PROXY_TARGET,
            changeOrigin: true,
            ws: true,
          },
          "^/(?!$|server/|@vite|@solid-refresh|@id|@fs|src/|node_modules/|assets/|favicon\\.ico|site\\.webmanifest|package\\.json|tsconfig\\.json).*": {
            target: process.env.VITE_OPENCODE_PROXY_TARGET,
            changeOrigin: true,
            ws: true,
          },
        }
      : undefined,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
