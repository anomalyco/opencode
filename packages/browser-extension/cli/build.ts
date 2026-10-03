// Bundles the CLI into one file (jsonc-parser included, borrowed from packages/cli) and copies the built
// extension next to it, keeping the manifest key so the unpacked ID matches the helper's allowed origins.
import { $ } from "bun"
import { cp, rm } from "node:fs/promises"
import path from "node:path"

const here = import.meta.dir
const extension = path.resolve(here, "..")
// The ESM build, so its internal imports bundle (the default entry is UMD with runtime requires).
const jsonc = path.join(path.dirname(Bun.resolveSync("jsonc-parser/package.json", path.resolve(here, "../../cli"))), "lib/esm/main.js")
await $`bun run build`.cwd(extension).quiet()
await rm(path.join(here, "dist"), { recursive: true, force: true })
await rm(path.join(here, "extension"), { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [path.join(here, "src/cli.ts")],
  outdir: path.join(here, "dist"),
  naming: "cli.mjs",
  target: "node",
  format: "esm",
  plugins: [{ name: "jsonc", setup: (build) => build.onResolve({ filter: /^jsonc-parser$/ }, () => ({ path: jsonc })) }],
})
if (!result.success) throw new AggregateError(result.logs, "build failed")
await cp(path.join(extension, "dist"), path.join(here, "extension"), {
  recursive: true,
  filter: (file) => !file.endsWith(".map"),
})
console.log("built dist/cli.mjs and extension/")
