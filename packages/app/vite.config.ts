import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
import desktopPlugin from "./vite.js"

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
      strategies: "generateSW",
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      workbox: {
        clientsClaim: false,
        skipWaiting: true,
        inlineWorkboxRuntime: true,
        // Always fetch the current HTML. Precaching a partial build can strand it without its chunks after an upgrade.
        navigateFallback: null,
        globPatterns: [],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              (url.pathname.startsWith("/_assets/") || url.pathname.startsWith("/assets/")),
            handler: "CacheFirst",
            options: {
              cacheName: "opencode-assets",
              plugins: [
                {
                  cachedResponseWillBeUsed: async ({ request, cachedResponse }) => {
                    if (
                      cachedResponse?.status === 200 &&
                      !/^(text\/html|application\/xhtml\+xml)\b/i.test(cachedResponse.headers.get("content-type") ?? "")
                    )
                      return cachedResponse
                    // Keep old tabs' precached chunks usable without retaining their stale HTML navigation handler.
                    const response = await caches.match(request, {
                      cacheName: `workbox-precache-v2-${self.location.origin}/`,
                    })
                    return response?.status === 200 &&
                      !/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get("content-type") ?? "")
                      ? response
                      : null
                  },
                  cacheWillUpdate: async ({ response }) =>
                    response.status === 200 &&
                    !/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get("content-type") ?? "")
                      ? response
                      : null,
                },
              ],
              expiration: {
                maxEntries: 1000,
              },
            },
          },
        ],
      },
    }),
    sentry,
  ] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    assetsDir: "_assets",
    target: "esnext",
    sourcemap: true,
  },
})
