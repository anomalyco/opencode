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

// lru_map is a UMD bundle. When @pierre/diffs is excluded from optimizeDeps,
// Vite serves lru_map as a raw file. The transform hook wraps it in a CJS
// context so the UMD's exports.LRUMap path fires, then re-exports as ESM.
import { readFileSync } from "node:fs"
const lruMapPlugin = {
  name: "lru-map-interop",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    const cleanId = id.split("?")[0]
    if (cleanId.includes("lru_map") && cleanId.endsWith("lru.js")) {
      return {
        code: [
          `const __lruMod = { exports: {} };`,
          `(function(module, exports) {`,
          code,
          `})(__lruMod, __lruMod.exports);`,
          `export const LRUMap = __lruMod.exports.LRUMap;`,
          `export default __lruMod.exports;`,
        ].join("\n"),
        map: null,
      }
    }
  },
}

import path from "node:path"

// session-ui uses `?worker&url` to import @pierre/diffs worker files.
// Vite's worker transform doesn't apply to workspace packages served as
// node_modules. This plugin intercepts those imports, resolves the worker
// file's absolute path, and exports its /@fs/ URL so new Worker(...) works.
const workerUrlPlugin = {
  name: "worker-url-interop",
  enforce: "pre" as const,
  resolveId(id: string, importer: string | undefined) {
    if (id.includes("?worker") && importer) {
      const cleanId = id.split("?")[0]
      const absPath = cleanId.startsWith(".")
        ? path.resolve(path.dirname(importer.split("?")[0]), cleanId)
        : cleanId
      return "\0worker-url:" + absPath
    }
  },
  load(id: string) {
    if (id.startsWith("\0worker-url:")) {
      const absPath = id.slice("\0worker-url:".length)
      return `export default "/@fs${absPath}";`
    }
  },
}

export default defineConfig({
  plugins: [lruMapPlugin, workerUrlPlugin, desktopPlugin, sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    cors: true,
    port: 3002,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["@pierre/diffs"],
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
