// Builds the data site's three Workers into one Build Output Specification tree (.cloudflare/output) for
// `cf deploy --prebuilt --worker <dir>` (script/deploy.ts):
// - default: the SolidStart site (packages/stats/app, Nitro's cloudflare-module preset) with .output/public as assets
// - og: the Open Graph image Worker, whose Wasm engines and fonts ship as modules
// - sync: the StatsSyncWorkflow and its cron handler (packages/stats/server)
// cf's own build step can't detect these projects, so they deploy prebuilt.
//
//   bun script/build.ts [--mode dev|production]
import { cp, mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import {
  cleanBuildOutputDir,
  getWorkerBundleDir,
  writeAssets,
  writeRootConfig,
  writeWorkerConfig,
} from "@cloudflare/build-output-utils"
import { resolveAndParseConfig } from "@cloudflare/config"

const root = path.resolve(import.meta.dir, "..")
const app = path.resolve(root, "../../packages/stats/app")
const server = path.resolve(root, "../../packages/stats/server")
const modeIndex = process.argv.indexOf("--mode")
const mode = modeIndex === -1 ? "production" : process.argv[modeIndex + 1]
if (mode !== "dev" && mode !== "production") throw new Error(`Unknown --mode ${mode}; use dev or production`)
// STAGE picks the stage's headers for the static assets (packages/stats/app/src/lib/noindex.ts).
const env = { ...process.env, STAGE: mode }

await Bun.$`bun run build`.cwd(app).env(env)
await Bun.$`bun run build:og`.cwd(app).env(env)

// @cloudflare/config's file loader refuses Bun; it resolves an imported config the same way.
async function resolve(file: string) {
  const parsed = await resolveAndParseConfig((await import(file)).default, { isPreview: false, mode })
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`)
  if (!parsed.data.worker) throw new Error(`${file} defines no worker`)
  return { ...parsed.data, worker: parsed.data.worker }
}
const site = await resolve("../cloudflare.config")
const og = await resolve("../og.config")
const sync = await resolve("../sync.config")

await cleanBuildOutputDir(root)
await writeRootConfig(
  root,
  { accountId: site.accountId, complianceRegion: site.complianceRegion },
  { isPreview: false, mode },
)

// The site: Nitro's server bundle and public directory.
await writeAssets({ root, sourceDirectory: path.join(app, ".output", "public") })
await cp(path.join(app, ".output", "server"), getWorkerBundleDir(root), {
  recursive: true,
  filter: (file) => !file.endsWith("wrangler.json") && !file.endsWith(".map"),
})
await writeWorkerConfig({
  root,
  config: site.worker,
  manifest: { type: "partial", mainModule: "index.mjs", modules: {} },
})

// The OG Worker: its bundle plus the Wasm and font modules it imports.
const ogFiles = await readdir(path.join(app, ".og-worker"))
await mkdir(getWorkerBundleDir(root, "og"), { recursive: true })
await cp(path.join(app, ".og-worker"), getWorkerBundleDir(root, "og"), { recursive: true })
await writeWorkerConfig({
  root,
  directoryName: "og",
  config: og.worker,
  manifest: {
    type: "partial",
    mainModule: "index.mjs",
    modules: Object.fromEntries(
      ogFiles.flatMap((file): [string, { type: "wasm" | "data" }][] => {
        if (file.endsWith(".wasm")) return [[file, { type: "wasm" }]]
        if (file.endsWith(".bin")) return [[file, { type: "data" }]]
        return []
      }),
    ),
  },
})

// The sync Worker, bundled for workerd.
const result = await Bun.build({
  entrypoints: [path.join(server, "src/worker.ts")],
  outdir: getWorkerBundleDir(root, "sync"),
  naming: "index.mjs",
  target: "browser",
  format: "esm",
  conditions: ["workerd", "worker", "browser"],
  external: ["cloudflare:*", "node:*"],
})
if (!result.success) throw new AggregateError(result.logs, "The sync Worker failed to build")
await writeWorkerConfig({
  root,
  directoryName: "sync",
  config: sync.worker,
  manifest: { type: "partial", mainModule: "index.mjs", modules: {} },
})

console.log(`data: built ${site.worker.name}, ${og.worker.name} and ${sync.worker.name} (${mode})`)
