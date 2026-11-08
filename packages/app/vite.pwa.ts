import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Plugin } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// The generated worker cannot host custom event handlers, so notificationclick lives in its own script (see
// notification-click.js). It exists for Chrome for Android, where the Notification constructor does not and
// notifications only show through the worker. The precache revision keeps its copy in step with the worker.
const NOTIFICATION_CLICK = "notification-click.js"

// The Office previews' engines and fonts (about 52 MB) load only when an Office file opens, so they stay out of the
// precache. The app's own fonts have no hyphenated name, such as `assets/Inter.ttf`.
const officeAsset =
  /(?:^|\/)(?:(?:docx_\w+|ooxml_opc|pptx_wasm|xlsx_wasm)_bg-[\w-]+\.wasm|residentEngineWorker-[\w-]+\.js|(?:Carlito|Caladea|LiberationSans|LiberationSerif|LiberationMono|NotoSansArabic|NotoNaskhArabic|NotoSansHebrew|Gelasio|ComicRelief|Inter|Roboto|SourceSans3|DMSans|DMSerifDisplay|OpenSans|Montserrat|Poppins|Oswald|Heebo)-[\w-]+\.ttf)$/

/** Whether a built file loads on demand instead of being precached. */
export function onDemandAsset(path: string) {
  return officeAsset.test(path)
}

export function serviceWorker(directory: string) {
  return [
    VitePWA({
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
        importScripts: [NOTIFICATION_CLICK],
        navigateFallback: "/index.html",
        // Pairing links must reach the server so it can set the session cookie.
        navigateFallbackDenylist: [/^\/(?:api|auth)(?:\/|$)/, /^\/(?:_assets|assets)(?:\/|$)/],
        // Include lazy chunks and non-JS dependencies, not just the startup bundle.
        globPatterns: ["**/*"],
        globIgnores: ["**/*.map", "_headers", "_redirects"],
        maximumFileSizeToCacheInBytes: Number.MAX_SAFE_INTEGER,
        manifestTransforms: [
          async (entries) => ({
            manifest: await Promise.all(
              entries
                .filter((entry) => !onDemandAsset(entry.url))
                .map(async (entry) => ({
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
    }),
    {
      name: "notification-click",
      async buildStart() {
        this.emitFile({
          type: "asset",
          fileName: NOTIFICATION_CLICK,
          source: await readFile(new URL("./notification-click.js", import.meta.url), "utf8"),
        })
      },
    } satisfies Plugin,
  ]
}
