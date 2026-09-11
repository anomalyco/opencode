import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import type { IncomingMessage } from "node:http"
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
    // Same-origin API access: the app defaults to location.origin, so every
    // backend route must be proxied in dev (works locally and behind a single
    // forwarded port in Codespaces). Browser navigations (Accept: text/html)
    // fall through to the SPA so client-side routes survive refresh.
    proxy: Object.fromEntries(
      [
        "/agent",
        "/api",
        "/auth",
        "/command",
        "/config",
        "/event",
        "/experimental",
        "/file",
        "/find",
        "/formatter",
        "/global",
        "/instance",
        "/log",
        "/lsp",
        "/mcp",
        "/openapi.json",
        "/path",
        "/permission",
        "/project",
        "/provider",
        "/pty",
        "/question",
        "/session",
        "/skill",
        "/sync",
        "/tui",
        "/vcs",
      ].map((prefix) => [
        prefix,
        {
          target: `http://${process.env.VITE_ARGUS_SERVER_HOST ?? "127.0.0.1"}:${process.env.VITE_ARGUS_SERVER_PORT ?? "4096"}`,
          changeOrigin: true,
          ws: true,
          bypass: (req: IncomingMessage) => {
            const pathname = new URL(req.url ?? "/", "http://localhost").pathname
            if (pathname.startsWith("/logo")) return pathname
            return req.headers.accept?.includes("text/html") ? "/index.html" : undefined
          },
        },
      ]),
    ),
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
