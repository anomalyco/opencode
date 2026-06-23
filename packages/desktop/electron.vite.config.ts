import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "@opencode-ai/app/vite"
import { build as esbuildBundle } from "esbuild"
import * as fs from "node:fs/promises"

const OPENCODE_SERVER_DIST = "../opencode/dist/node"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

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
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        // The server bundle is ~30MB of pre-bundled bun output (it embeds the
        // TypeScript compiler for static workflow meta extraction). Piping it
        // through rollup corrupts the rendered chunk, so it is copied verbatim
        // next to the sidecar and loaded at runtime (see sidecar.ts). The .wasm
        // assets resolve relative to the server entry, so they live in the same
        // directory.
        name: "opencode:copy-server-assets",
        async writeBundle() {
          // The bun-built server externalizes jsonc-parser and the pty wrapper
          // (script/build-node.ts); rollup used to inline them when it ingested
          // the bundle. A plain esbuild pass makes the runtime artifact
          // self-contained — only the native pty platform packages stay
          // external (electron-builder smart-unpacks them next to the asar,
          // where the runtime require resolves them from the real filesystem).
          await esbuildBundle({
            entryPoints: [`${OPENCODE_SERVER_DIST}/node.js`],
            bundle: true,
            platform: "node",
            format: "esm",
            target: "node22",
            // Prefer ESM package entries: jsonc-parser's default (UMD) main
            // carries an AMD branch whose dynamic requires cannot run inside
            // an ESM bundle ("Dynamic require of ./impl/format").
            mainFields: ["module", "main"],
            external: [nodePtyPkg, "electron"],
            outfile: "./out/main/opencode-server.mjs",
            minify: false,
            logLevel: "error",
            plugins: [
              {
                // The pty wrapper requires its platform package dynamically,
                // which esbuild's ESM __require shim cannot serve. Resolve the
                // wrapper to a tiny shim that loads the (smart-unpacked native)
                // platform package via a real createRequire at runtime — the
                // same wrapper→platform substitution the main bundle uses.
                name: "opencode:pty-runtime-require",
                setup(build) {
                  build.onResolve({ filter: /^@lydell\/node-pty$/ }, () => ({
                    path: "pty-shim",
                    namespace: "opencode-pty",
                  }))
                  build.onLoad({ filter: /^pty-shim$/, namespace: "opencode-pty" }, () => ({
                    contents: [
                      `import { createRequire as __createRequire } from "node:module"`,
                      `const __pty = __createRequire(import.meta.url)(${JSON.stringify(nodePtyPkg)})`,
                      `export const spawn = (...args) => __pty.spawn(...args)`,
                      `export default __pty`,
                    ].join("\n"),
                  }))
                },
              },
            ],
          })
          for (const l of await fs.readdir(OPENCODE_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/${l}`, await fs.readFile(`${OPENCODE_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
