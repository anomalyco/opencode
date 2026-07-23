import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"
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

const pwa = VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["favicon.svg", "favicon.ico", "apple-touch-icon-v3.png"],
  manifest: {
    name: "OpenCode",
    short_name: "OpenCode",
    description: "AI-powered development tool",
    theme_color: "#080808",
    background_color: "#080808",
    display: "standalone",
    orientation: "portrait-primary",
    categories: ["developer", "productivity", "utilities"],
    prefer_related_applications: false,
    icons: [
      {
        src: "web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
    navigateFallback: "/offline.html",
    navigateFallbackAllowlist: [/^(?!\/api)/],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/.*\.opencode\.ai\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "api-cache",
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 60 * 60, // 1 hour
          },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts",
          expiration: {
            maxEntries: 10,
            maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
          },
        },
      },
    ],
  },
  devOptions: {
    enabled: process.env.NODE_ENV === "development",
  },
})

export default defineConfig({
  plugins: [desktopPlugin, sentry, pwa] as any,
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
