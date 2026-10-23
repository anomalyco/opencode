// Builds the published package: dist/cli.mjs (main.ts and everything it loads, with npm dependencies left
// external and installed by npm) and extension/ (the built unpacked extension, keeping its manifest key so the
// unpacked ID matches the host's allowed origins). Both carry this package's version.
import { $ } from "bun"
import { chmod, cp, rm } from "node:fs/promises"
import path from "node:path"

const here = import.meta.dir
const extension = path.resolve(here, "..")
const pkg = await Bun.file(path.join(here, "package.json")).json()

const build = new Date().toISOString()
await $`bun run build`.cwd(extension).env({ ...process.env, OPENCODE_BROWSER_BUILD: build }).quiet()
await rm(path.join(here, "dist"), { recursive: true, force: true })
await rm(path.join(here, "extension"), { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: [path.join(here, "src/main.ts")],
  outdir: path.join(here, "dist"),
  naming: "cli.mjs",
  target: "node",
  format: "esm",
  // Runtime dependencies stay external; jsonc-parser (a dev dependency) is bundled.
  external: Object.keys(pkg.dependencies ?? {}),
  plugins: [
    {
      // jsonc-parser's default entry is UMD with runtime requires; its ESM build bundles cleanly.
      name: "jsonc-parser-esm",
      setup(build) {
        build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
          path: path.join(path.dirname(Bun.resolveSync("jsonc-parser/package.json", here)), "lib/esm/main.js"),
        }))
      },
    },
  ],
  define: {
    "globalThis.__OPENCODE_BROWSER_VERSION__": JSON.stringify(pkg.version),
    "globalThis.__OPENCODE_BROWSER_BUILD_ID__": JSON.stringify(new Date().toISOString()),
  },
})
if (!result.success) throw new AggregateError(result.logs, "build failed")
const cli = path.join(here, "dist", "cli.mjs")
const source = await Bun.file(cli).text()
await Bun.write(cli, source.startsWith("#!") ? source : `#!/usr/bin/env node\n${source}`)
await chmod(cli, 0o755)

await cp(path.join(extension, "dist"), path.join(here, "extension"), {
  recursive: true,
  filter: (file) => !file.endsWith(".map"),
})
const manifestFile = path.join(here, "extension", "manifest.json")
const manifest = await Bun.file(manifestFile).json()
manifest.version = pkg.version
await Bun.write(manifestFile, JSON.stringify(manifest, null, 2) + "\n")
// install compares this with the build a connected extension reports, to skip a reload that changes nothing.
await Bun.write(path.join(here, "extension", "build.json"), JSON.stringify({ build }) + "\n")
console.log(`built dist/cli.mjs and extension/ (${pkg.version})`)
