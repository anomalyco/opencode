import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import desktopPlugin from "./vite"
import { navigateFallbackAllowlist } from "./src/pwa"

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
    VitePWA({
      registerType: "prompt",
      manifest: false,
      devOptions: {
        // SW disabled in dev — active SW intercepts Vite HMR requests and breaks hot reload
        enabled: false,
      },
      includeAssets: ["favicon*.{ico,png,svg}", "apple-touch-icon*.png", "web-app-manifest-*.png", "site.webmanifest"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff,woff2,ttf,eot,png,svg,ico}"],
        navigateFallback: "/index.html",
        // Only explicit SPA routes receive the navigation fallback.
        // All other paths (API, auth, events, etc.) pass to the network by default.
        // Allowlist is the shared source of truth in ./src/pwa (assertable in tests).
        navigateFallbackAllowlist,
      },
    }),
    sentry,
  ] as any, // as any: vite.js custom plugin typings don't fully satisfy Vite's Plugin union
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
