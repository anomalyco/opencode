import { readFileSync } from "node:fs"
import type { Plugin } from "vite"
import manifest from "./manifest.json" with { type: "json" }

export function icons(channel: string): Plugin {
  const selected = channel === "beta" || channel === "prod" ? channel : "dev"
  const prefix = `icons/${selected}`
  const files = [
    ...Object.entries({
      "favicon.ico": "icon.ico",
      "apple-touch-icon.png": "ios/AppIcon-60x60@3x.png",
      "web-app-manifest-192x192.png": "android/mipmap-xxxhdpi/ic_launcher.png",
      "web-app-manifest-512x512.png": "icon.png",
    }).map(([name, source]) => ({
      fileName: `${prefix}/${name}`,
      source: readFileSync(new URL(`../desktop/icons/${selected}/${source}`, import.meta.url)),
      type: name.endsWith(".ico") ? "image/x-icon" : "image/png",
    })),
    {
      fileName: "site.webmanifest",
      source: JSON.stringify({
        ...manifest,
        icons: manifest.icons.map((icon) => ({ ...icon, src: `/${prefix}${icon.src}` })),
      }),
      type: "application/manifest+json",
    },
  ]

  return {
    name: "opencode-app:icons",
    generateBundle() {
      files.forEach((file) => this.emitFile({ type: "asset", fileName: file.fileName, source: file.source }))
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = files.find((file) => `/${file.fileName}` === request.url?.split("?")[0])
        if (!file) return next()
        response.setHeader("Content-Type", file.type)
        response.end(file.source)
      })
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replace("%OPENCODE_FAVICON%", `/${prefix}/favicon.ico`)
          .replace("%OPENCODE_APPLE_TOUCH_ICON%", `/${prefix}/apple-touch-icon.png`)
      },
    },
  }
}
