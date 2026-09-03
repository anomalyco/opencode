import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { VitePWA } from "vite-plugin-pwa"

export function serviceWorker(directory: string) {
  return VitePWA({
    strategies: "generateSW",
    registerType: "prompt",
    injectRegister: false,
    manifest: false,
    workbox: {
      // Workbox runs after Sentry's upload and cleanup, so do not publish an unuploaded map.
      sourcemap: false,
      globDirectory: directory,
      clientsClaim: false,
      // Keep each open tab on its complete build until all old clients close.
      skipWaiting: false,
      inlineWorkboxRuntime: true,
      navigateFallback: "/index.html",
      navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/(?:_assets|assets)(?:\/|$)/],
      // Include lazy chunks and non-JS dependencies, not just the startup bundle.
      globPatterns: ["**/*"],
      globIgnores: ["**/*.map", "_headers", "_redirects"],
      maximumFileSizeToCacheInBytes: Number.MAX_SAFE_INTEGER,
      manifestTransforms: [
        async (entries) => ({
          manifest: await Promise.all(
            entries.map(async (entry) => ({
              ...entry,
              // A revision labels a cache entry; integrity rejects mixed deployments
              // and HTML fallback responses instead of installing a broken build.
              integrity: `sha256-${createHash("sha256")
                .update(await readFile(resolve(directory, entry.url)))
                .digest("base64")}`,
            })),
          ),
          warnings: [],
        }),
      ],
    },
  })
}
