// Builds the site into the Build Output Specification tree (.cloudflare/output) for
// `cf deploy --prebuilt --mode <mode>` (package.json deploy:dev and deploy:production): the
// SolidStart server (Nitro's cloudflare-module preset, .output/server) as the Worker and
// .output/public as its assets. cf's own build step can't detect this project, so it deploys prebuilt.
//
//   bun script/build.ts [--mode dev|production]
import { appendFile, cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import {
  cleanBuildOutputDir,
  getWorkerBundleDir,
  writeAssets,
  writeRootConfig,
  writeWorkerConfig,
} from "@cloudflare/build-output-utils"
import { resolveAndParseConfig } from "@cloudflare/config"
import { mediaFile } from "../src/lib/media"
import { stageHeaders } from "../src/lib/noindex"
import { retainAssets } from "./retain-assets"

const root = path.resolve(import.meta.dir, "..")
const modeIndex = process.argv.indexOf("--mode")
const mode = modeIndex === -1 ? "production" : process.argv[modeIndex + 1]
if (mode !== "dev" && mode !== "production") throw new Error(`Unknown --mode ${mode}; use dev or production`)
// The package's own binaries (vite) for every step, as a package script would have.
const env = {
  ...process.env,
  PATH: `${path.join(root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
}

// David's build, plus the files the site serves at fixed URLs (/openapi.json, /config.json).
await Bun.$`bun run generate`.cwd(root).env(env)
await Bun.$`bun ./script/build-stamp.ts`.cwd(root).env(env)
await Bun.$`bun ./script/github-snapshot.ts`.cwd(root).env(env)
await requireSnapshot()
await Bun.$`bun ./script/og.ts`.cwd(root).env(env)
await Bun.$`bun ./textjs/script/build.ts`.cwd(root).env(env)
await Bun.$`vite build`.cwd(root).env(env)
// The V2 docs at /docs: prerendered pages, Markdown twins and search (src/docs/script/build.ts).
await Bun.$`bun ./src/docs/script/build.ts`.cwd(root).env(env)
await Bun.$`bun ./script/check-server-bundle.ts`.cwd(root).env(env)
await Bun.$`bun ./script/check-client-bundle.ts`.cwd(root).env(env)
await Bun.$`bun ./script/check-css-output.ts`.cwd(root).env(env)

// @cloudflare/config's file loader refuses Bun; it resolves an imported config the same way.
const parsed = await resolveAndParseConfig((await import("../cloudflare.config")).default, { isPreview: false, mode })
if (!parsed.success) throw new Error(`cloudflare.config.ts: ${parsed.error.message}`)
const config = parsed.data
if (!config.worker) throw new Error("cloudflare.config.ts defines no worker")

await cleanBuildOutputDir(root)
await writeRootConfig(
  root,
  { accountId: config.accountId, complianceRegion: config.complianceRegion },
  { isPreview: false, mode },
)

// Heavy media is never a Worker asset; it is served from the files bucket (src/lib/media.ts).
const assets = path.join(root, "dist", "assets")
await rm(assets, { recursive: true, force: true })
await cp(path.join(root, ".output", "public"), assets, {
  recursive: true,
  filter: (file) => !mediaFile.test(file),
})
const shipped = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: assets, dot: true }))
// Every opencode.json and V1 TUI config names these as its $schema; /openapi.json is the protocol's.
// The V2 config names /v2/cli.json, and the docs link /docs/openapi.json.
const fixed = ["config.json", "tui.json", "openapi.json", "v2/cli.json", "docs/openapi.json"].filter(
  (file) => !shipped.includes(file),
)
if (fixed.length) throw new Error(`fixed-URL files missing from Worker assets: ${fixed.join(", ")}`)
// The stage's headers for the assets the Worker never sees; its own responses get them from src/lib/noindex.ts.
const headers = Object.entries(stageHeaders(mode)).map(([name, value]) => `  ${name}: ${value}\n`)
if (headers.length) await appendFile(path.join(assets, "_headers"), `\n/*\n${headers.join("")}`)
// Open pages from earlier builds keep loading their code after this deploy (script/retain-assets.ts).
await retainAssets(assets, mode === "dev" ? "https://dev.opencode.ai" : "https://opencode.ai")
await writeAssets({ root, sourceDirectory: assets })

const bundle = getWorkerBundleDir(root)
await mkdir(bundle, { recursive: true })
await cp(path.join(root, ".output", "server"), bundle, {
  recursive: true,
  filter: (file) => !file.endsWith("wrangler.json") && !file.endsWith(".map"),
})
await writeWorkerConfig({
  root,
  config: config.worker,
  manifest: { type: "partial", mainModule: "index.mjs", modules: {} },
})
// The bundle checks read the files; this starts the Worker that would be deployed and loads pages.
await Bun.$`bun ./script/check-worker-start.ts`.cwd(root).env(env)
console.log(`site: built ${config.worker.name} (${mode}), ${shipped.length} assets`)

/** In CI the snapshot is what /changelog.json serves when GitHub fails, so it must have releases. */
async function requireSnapshot() {
  const snapshot = await Bun.file(path.join(root, "src/lib/github-snapshot.json"))
    .json()
    .catch(() => ({}))
  const releases = Array.isArray(snapshot.releases) ? snapshot.releases.length : 0
  if (releases > 0) return
  if (process.env.CI) throw new Error("github-snapshot.json has no releases; set GITHUB_TOKEN for the build")
  console.warn("site: github-snapshot.json has no releases (GitHub rate limit?); /changelog.json has no fallback")
}
