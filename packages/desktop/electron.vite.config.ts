import { defineConfig } from "electron-vite"
import { pickerPlugin } from "./scripts/picker"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "local" || raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

const appPlugin = (await import("@opencode/app/vite")).default
const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? (await import("@sentry/vite-plugin")).sentryVitePlugin({
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

// Every module the entry reaches through static imports lands in one chunk. Automatic splitting
// otherwise fragments the initial graph into ~50 files shared with lazy routes, and each file costs
// the renderer a main-thread request round trip through the main process before first paint.
type ChunkingContext = { getModuleInfo(id: string): { isEntry: boolean; importers: readonly string[] } | null }
const initialGraph = new WeakMap<ChunkingContext, Map<string, boolean>>()
function inInitialGraph(id: string, ctx: ChunkingContext) {
  const memo = initialGraph.get(ctx) ?? new Map<string, boolean>()
  initialGraph.set(ctx, memo)
  const visit = (id: string, path: Set<string>): boolean => {
    const known = memo.get(id)
    if (known !== undefined) return known
    if (path.has(id)) return false
    const info = ctx.getModuleInfo(id)
    if (!info) return false
    path.add(id)
    const result = info.isEntry || info.importers.some((importer) => visit(importer, path))
    path.delete(id)
    memo.set(id, result)
    return result
  }
  return visit(id, new Set())
}

export default defineConfig(({ command }) => ({
  main: {
    resolve: {
      dedupe: ["effect"],
    },
    define: {
      // Local renderer/server mode still uses the dev application identity and updater policy.
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel === "local" ? "dev" : channel),
    },
    build: {
      minify: command === "build",
      rolldownOptions: {
        input: { index: "src/main/index.ts" },
        // Keep this identical to electron-vite's Node 20.11+ shim. Its regex insertion can
        // corrupt bundled TypeScript, while an output banner places the shim safely.
        output: {
          format: "es",
          // DesktopPaths resolves resources from the main output directory,
          // including when the lazy desktop entry shares it with other chunks.
          chunkFileNames: "[name]-[hash].js",
          banner: `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`,
        },
      },
      externalizeDeps: {
        // Bundle the Effect family together.
        exclude: ["effect", "@effect/platform-node", "@effect/platform-node-shared", "drizzle-orm"],
        include: [nodePtyPkg],
      },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
          return undefined
        },
      },
    ],
  },
  preload: {
    build: {
      minify: command === "build",
      rolldownOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          // The package is "type": "module". Under --no-sandbox Electron loads the preload
          // through Node's module loader, which treats a .js file as ESM and fails on
          // require("electron"). The sandboxed path ignores the extension.
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    experimental: {
      bundledDev: true,
    },
    define: {
      "import.meta.env.OPENCODE_VERSION": JSON.stringify(process.env.OPENCODE_VERSION),
      "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
      "import.meta.env.OPENCODE_TEST_ONBOARDING": JSON.stringify(
        command === "serve" && process.env.OPENCODE_TEST_ONBOARDING === "1",
      ),
    },
    plugins: [pickerPlugin(), appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      minify: command === "build",
      sourcemap: true,
      rolldownOptions: {
        input: {
          main: "src/renderer/index.html",
        },
        output: {
          codeSplitting: {
            groups: [{ name: (id, ctx) => (inInitialGraph(id, ctx) ? "app" : null), priority: 10 }],
          },
        },
      },
    },
  },
}))
