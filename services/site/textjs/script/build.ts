// Builds the Text.js console apps that window.opencode loads on demand into the site's
// public/textjs/, with a manifest.json that maps each app to its hashed entry file.
//
// - picker: opencode.install.pick(), from src/picker.tsx.
// - lite: OpenCode Lite, which starts when DevTools opens or from opencode.try(). Its source is the
//   opencode-console app in anomalyco/textjs (MIT), which isn't published to npm; it is downloaded
//   at the pinned commit into .upstream/. If the download fails the build still writes the picker,
//   and try() falls back to a link to textjs.org/opencode.
import { createHash } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

const commit = "760efedde45eb77b786db4c1658a0dd9126f079e"
const root = path.resolve(import.meta.dir, "..")
const upstream = path.join(root, ".upstream")
const out = path.resolve(root, "../public/textjs")

// Text.js 1.6 loads Yoga from a .wasm file and the bidi engine from its own chunk under the
// `@textjs/client` resolve condition, which `text build` sets. Bun's bundler leaves the loader's
// `new URL("@textjs/core/yoga.wasm", import.meta.url)` alone, so the entries load the file
// themselves (`initYoga({ wasm })`) from a name hashed by its contents, defined into them below.
const yoga = await Bun.file(new URL(import.meta.resolve("@textjs/core/yoga.wasm"))).bytes()
const yogaName = `yoga-${createHash("sha256").update(yoga).digest("hex").slice(0, 8)}.wasm`

const lite = await fetchUpstream().then(
  () => true,
  (error) => {
    console.warn(`textjs: OpenCode Lite skipped, couldn't fetch anomalyco/textjs@${commit.slice(0, 7)}: ${error}`)
    return false
  },
)
await rm(out, { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [path.join(root, "src/picker.tsx"), ...(lite ? [path.join(root, "src/lite.tsx")] : [])],
  outdir: out,
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  conditions: ["@textjs/client"],
  naming: { entry: "[name]-[hash].[ext]", chunk: "chunk-[hash].[ext]" },
  define: {
    "process.env.NODE_ENV": '"production"',
    __TEXTJS_YOGA__: JSON.stringify(`./${yogaName}`),
  },
})
if (!result.success) throw new AggregateError(result.logs, "textjs build failed")
await Bun.write(path.join(out, yogaName), yoga)
const entries = result.outputs.filter((output) => output.kind === "entry-point")
const manifest = Object.fromEntries(
  entries.map((entry) => [path.basename(entry.path).split("-")[0], path.basename(entry.path)]),
)
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest))
// What each app downloads: its entry, every chunk it imports statically, and then the chunks it
// fetches on demand (the bidi engine, the session dialogs), plus Yoga's wasm.
const sizes = new Map(
  await Promise.all(
    result.outputs.map(async (output) => {
      const bytes = await Bun.file(output.path).bytes()
      const text = new TextDecoder().decode(bytes)
      const imports = [...text.matchAll(/from"\.\/([\w-]+\.js)"/g)].map((match) => match[1])
      const lazy = [...text.matchAll(/import\("\.\/([\w-]+\.js)"\)/g)].map((match) => match[1])
      return [path.basename(output.path), { bytes: bytes.length, gzip: Bun.gzipSync(text).length, imports, lazy }] as const
    }),
  ),
)
const closure = (file: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(file)) return seen
  seen.add(file)
  sizes.get(file)?.imports.forEach((next) => closure(next, seen))
  return seen
}
const lazyClosure = (eager: string[]): Set<string> => {
  const seen = new Set<string>()
  const known = new Set(eager)
  for (const file of eager) sizes.get(file)?.lazy.forEach((next) => closure(next, seen))
  return new Set([...seen].filter((file) => !known.has(file)))
}
for (const [name, file] of Object.entries(manifest)) {
  const files = [...closure(file)]
  const kb = (key: "bytes" | "gzip", list: string[]) =>
    (list.reduce((sum, f) => sum + (sizes.get(f)?.[key] ?? 0), 0) / 1024).toFixed(1)
  console.log(`textjs: ${name} ${kb("bytes", files)} KB, ${kb("gzip", files)} KB gzip (${files.length} files)`)
  const lazy = [...lazyClosure(files)]
  if (lazy.length) console.log(`textjs: ${name} +${kb("gzip", lazy)} KB gzip on demand (${lazy.join(", ")})`)
  const yogaKb = `${(yoga.length / 1024).toFixed(1)} KB, ${(Bun.gzipSync(yoga).length / 1024).toFixed(1)} KB gzip`
  console.log(`textjs: ${name} +${yogaKb} yoga (${yogaName})`)
}

async function fetchUpstream() {
  const marker = path.join(upstream, "COMMIT")
  if ((await Bun.file(marker).exists()) && (await Bun.file(marker).text()) === commit) return
  const response = await fetch(`https://codeload.github.com/anomalyco/textjs/tar.gz/${commit}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  await rm(upstream, { recursive: true, force: true })
  await mkdir(upstream, { recursive: true })
  const archive = path.join(upstream, "textjs.tar.gz")
  await Bun.write(archive, response)
  const folder = `textjs-${commit}/apps/opencode-console`
  const tar = Bun.spawnSync(["tar", "-xzf", archive, "-C", upstream, "--strip-components=2", folder])
  if (tar.exitCode !== 0) throw new Error(tar.stderr.toString())
  await rm(archive)
  await Bun.write(marker, commit)
}
