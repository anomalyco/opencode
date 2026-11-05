// Builds the Text.js console apps that window.opencode loads on demand into the site's
// public/textjs/, with a manifest.json that maps each app to its hashed entry file.
//
// - picker: opencode.install.pick(), from src/picker.tsx.
// - lite: opencode.try(), OpenCode Lite. Its source is the opencode-console app in
//   anomalyco/textjs (MIT), which isn't published to npm; it is downloaded at the pinned commit into
//   .upstream/. If the download fails the build still writes the picker, and try() falls back to a
//   link to textjs.org/opencode.
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

const commit = "760efedde45eb77b786db4c1658a0dd9126f079e"
const root = path.resolve(import.meta.dir, "..")
const upstream = path.join(root, ".upstream")
const out = path.resolve(root, "../site/public/textjs")

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
  naming: { entry: "[name]-[hash].[ext]", chunk: "chunk-[hash].[ext]" },
  define: { "process.env.NODE_ENV": '"production"' },
})
if (!result.success) throw new AggregateError(result.logs, "textjs build failed")
const entries = result.outputs.filter((output) => output.kind === "entry-point")
const manifest = Object.fromEntries(
  entries.map((entry) => [path.basename(entry.path).split("-")[0], path.basename(entry.path)]),
)
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest))
// What each app downloads: its entry plus every chunk it imports statically.
const sizes = new Map(
  await Promise.all(
    result.outputs.map(async (output) => {
      const text = await Bun.file(output.path).text()
      const imports = [...text.matchAll(/from"\.\/([\w-]+\.js)"/g)].map((match) => match[1])
      return [path.basename(output.path), { bytes: text.length, gzip: Bun.gzipSync(text).length, imports }] as const
    }),
  ),
)
const closure = (file: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(file)) return seen
  seen.add(file)
  sizes.get(file)?.imports.forEach((next) => closure(next, seen))
  return seen
}
for (const [name, file] of Object.entries(manifest)) {
  const files = [...closure(file)]
  const kb = (key: "bytes" | "gzip") =>
    (files.reduce((sum, f) => sum + (sizes.get(f)?.[key] ?? 0), 0) / 1024).toFixed(1)
  console.log(`textjs: ${name} ${kb("bytes")} KB, ${kb("gzip")} KB gzip (${files.length} files)`)
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
