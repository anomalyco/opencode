// Builds the www Worker into the Build Output Specification tree (.cloudflare/output) that
// `cf deploy` reads: the V2 docs (Astro, src/, under /v2), the site (SolidStart, site/), one merged
// assets directory, and worker.ts routing between the two servers.
//
//   bun script/build.ts [--mode dev|production]
//
// Then `cf deploy --prebuilt --mode <mode>` (package.json deploy:dev and deploy:production): cf's
// own build step can't pick between the two frameworks.
import { cp, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import {
  cleanBuildOutputDir,
  getWorkerBundleDir,
  writeAssets,
  writeRootConfig,
  writeWorkerConfig,
} from "@cloudflare/build-output-utils"
import { resolveAndParseConfig } from "@cloudflare/config"
import { mediaFile } from "../site/src/lib/media"

const root = path.resolve(import.meta.dir, "..")
const site = path.join(root, "site")
const modeIndex = process.argv.indexOf("--mode")
const mode = modeIndex === -1 ? "production" : process.argv[modeIndex + 1]
if (mode !== "dev" && mode !== "production") throw new Error(`Unknown --mode ${mode}; use dev or production`)
// The package's own binaries (astro, vite, pagefind) for every step, as a package script would have.
const env = {
  ...process.env,
  CLOUDFLARE_ENV: mode,
  PATH: `${path.join(root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
}

// The docs, as before (package scripts generate, validate; script/pagefind.ts, prepare-cloudflare.ts).
await Bun.$`bun run generate`.cwd(root).env(env)
await Bun.$`astro build`.cwd(root).env(env)
await Bun.$`bun script/pagefind.ts`.cwd(root).env(env)
await Bun.$`bun run validate`.cwd(root).env(env)
await Bun.$`bun script/prepare-cloudflare.ts`.cwd(root).env(env)

// The site, as David's build ran it. `bun run generate` above wrote site/public/config.json.
await Bun.$`bun ./script/build-stamp.ts`.cwd(site).env(env)
await Bun.$`bun ./script/github-snapshot.ts`.cwd(site).env(env)
await requireSnapshot()
await Bun.$`bun ./script/og.ts`.cwd(site).env(env)
await Bun.$`bun ../textjs/script/build.ts`.cwd(site).env(env)
await Bun.$`vite build`.cwd(site).env(env)
await Bun.$`bun ./script/check-server-bundle.ts`.cwd(site).env(env)
await Bun.$`bun ./script/check-client-bundle.ts`.cwd(site).env(env)

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

// One assets directory: the docs' (everything under v2/) and the site's (the root). Heavy media is
// never a Worker asset; it is served from the files bucket (site/src/lib/media.ts).
const assets = path.join(root, "dist", "assets")
await rm(assets, { recursive: true, force: true })
await cp(path.join(root, "dist", "client"), assets, { recursive: true })
await mergeSiteAssets(path.join(site, ".output", "public"), assets)
// The protocol's OpenAPI document is served at the root as well as at /v2/openapi.json (the docs'
// link): the same file (script/generate-openapi.ts), with a 200 and no redirect at either address.
await cp(path.join(assets, "v2", "openapi.json"), path.join(assets, "openapi.json"))
await writeAssets({ root, sourceDirectory: assets })

// The bundle: worker.ts plus each framework's server, unbundled, in its own folder.
const bundle = getWorkerBundleDir(root)
await mkdir(bundle, { recursive: true })
await cp(path.join(root, "dist", "server"), path.join(bundle, "docs"), {
  recursive: true,
  filter: (file) => !file.endsWith("wrangler.json"),
})
await cp(path.join(site, ".output", "server"), path.join(bundle, "site"), {
  recursive: true,
  filter: (file) => !file.endsWith("wrangler.json") && !file.endsWith(".map"),
})
const entry = await Bun.build({
  entrypoints: [path.join(root, "worker.ts")],
  outdir: bundle,
  naming: "worker.mjs",
  target: "browser",
  format: "esm",
  external: ["./docs/*", "./site/*"],
})
if (!entry.success) throw new AggregateError(entry.logs, "worker.ts build failed")
await writeWorkerConfig({
  root,
  config: config.worker,
  manifest: { type: "partial", mainModule: "worker.mjs", modules: {} },
})
console.log(`www: built ${config.worker.name} (${mode})`)

/** Copies the site's assets over the docs', refusing a path both write with different bytes. */
async function mergeSiteAssets(from: string, into: string) {
  const files = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: from, dot: true }))
  const headers = files.includes("_headers")
  const clashes = await Promise.all(
    files
      .filter((file) => file !== "_headers" && !mediaFile.test(file))
      .map(async (file) => {
        const target = Bun.file(path.join(into, file))
        if (!(await target.exists())) return
        const same = Buffer.compare(
          Buffer.from(await target.arrayBuffer()),
          Buffer.from(await Bun.file(path.join(from, file)).arrayBuffer()),
        )
        return same === 0 ? undefined : file
      }),
  )
  const conflicts = clashes.filter((file) => file !== undefined)
  if (conflicts.length) throw new Error(`docs and site both write: ${conflicts.join(", ")}`)
  await Promise.all(
    files
      .filter((file) => file !== "_headers" && !mediaFile.test(file))
      .map((file) => cp(path.join(from, file), path.join(into, file))),
  )
  if (headers) {
    const docs = Bun.file(path.join(into, "_headers"))
    const merged = `${(await docs.exists()) ? await docs.text() : ""}\n${await Bun.file(path.join(from, "_headers")).text()}`
    await Bun.write(path.join(into, "_headers"), merged)
  }
  const shipped = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: into, dot: true }))
  const heavy = shipped.filter((file) => mediaFile.test(file))
  if (heavy.length) throw new Error(`heavy media in Worker assets: ${heavy.join(", ")}`)
  // Every opencode.json and V1 TUI config names these as its $schema.
  const schemas = ["config.json", "tui.json"].filter((file) => !shipped.includes(file))
  if (schemas.length) throw new Error(`schema files missing from Worker assets: ${schemas.join(", ")}`)
  console.log(`www: ${shipped.length} assets (${(await readdir(into)).length} top-level entries)`)
}

/** In CI the snapshot is what /changelog.json serves when GitHub fails, so it must have releases. */
async function requireSnapshot() {
  const snapshot = await Bun.file(path.join(site, "src/lib/github-snapshot.json"))
    .json()
    .catch(() => ({}))
  const releases = Array.isArray(snapshot.releases) ? snapshot.releases.length : 0
  if (releases > 0) return
  if (process.env.CI) throw new Error("github-snapshot.json has no releases; set GITHUB_TOKEN for the build")
  console.warn("www: github-snapshot.json has no releases (GitHub rate limit?); /changelog.json has no fallback")
}
