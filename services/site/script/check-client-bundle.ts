// Fails the build when a development tool reaches the browser bundle: Settings (settings-panel.tsx),
// Design mode (design-mode.tsx, design-overlay.tsx) or the device preview (device-preview.tsx,
// device-preview-panel.tsx). They load only on the development server, through loaders a production
// build compiles away: `import.meta.env.DEV ? lazy(() => import("./settings-panel")) : undefined`.
// Also fails when server-only code reaches it: the Worker's cache, GitHub calls and the build-time
// GitHub snapshot. Pages may import their modules for the queries, whose "use server" bodies the
// browser build drops along with everything only those bodies read.
// Last, it fails when a page's initial JavaScript (the entry and every chunk the page's route imports
// statically, which the server modulepreloads) passes the budget below, gzipped. Code a page needs
// only later belongs behind a dynamic import.
// Run after `vite build`, optionally with the output directory: `bun script/check-client-bundle.ts .output`.
import path from "node:path"
import { Glob } from "bun"

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "..", ".output"), "public")
// Strings only the tools' own code contains, as they survive minification.
const scriptMarkers = [
  "opencode-site-design-mode", // design-mode.tsx: whether Design mode is on
  "opencode-site-design-copy-v2", // design-mode.tsx: the saved copy choices
  "design-export", // design-overlay.tsx
  "settings-backdrop", // settings-panel.tsx
  'opencode-site-device-preview"', // device-preview-panel.tsx: the saved device
  "Toggle Design mode", // search-index.ts: the ⌘K action
  "Open Settings", // search-index.ts: the ⌘K action
  "edge-cache.opencode.internal", // lib/edge-cache.ts
  "api.github.com", // lib/changelog-releases.ts
]
// The tools' styles (settings-panel.css, design-mode.css, device-preview.css).
const styleMarker =
  /\[data-component="?(settings-panel|settings-backdrop|design-overlay|design-controls|design-export|history-toast|device-preview)"?\]/
// Chunks named after the tools' modules, or after the GitHub snapshot (lib/github-snapshot.json).
const chunkName =
  /(^|\/)(design-mode|design-overlay|settings-panel|device-preview|device-preview-panel|page-settings|settings-transfer|github-snapshot)-[\w-]+\.(js|css)$/

const files = await Array.fromAsync(new Glob("**/*.{js,mjs,css}").scan({ cwd: root }))
if (!files.length) {
  console.error(`check-client-bundle: no client output in ${root}; run vite build first`)
  process.exit(1)
}
const found = (
  await Promise.all(
    files.map(async (file) => {
      if (chunkName.test(file)) return [`${file}: a development tool's or server-only chunk`]
      const text = await Bun.file(path.join(root, file)).text()
      if (file.endsWith(".css")) {
        const match = text.match(styleMarker)
        return match ? [`${file}: ${match[0]}`] : []
      }
      return scriptMarkers.filter((marker) => text.includes(marker)).map((marker) => `${file}: ${marker}`)
    }),
  )
).flat()
if (found.length) {
  console.error(
    "check-client-bundle: Settings, Design mode, device preview or server-only code is in the client bundle:\n  " +
      found.join("\n  "),
  )
  process.exit(1)
}
console.log(
  `check-client-bundle: ${files.length} client files, no Settings, Design mode, device preview or server-only code`,
)

// In kB, gzipped. The heaviest pages, the legal documents (which carry their text), were 195 kB when
// this was set; every other page was under 185 kB.
const budget = 210
type Chunk = { file: string; imports?: string[] }
const manifest: Record<string, Chunk> = await Bun.file(path.join(root, ".vite/manifest.json")).json()
const sizes = new Map<string, number>()
const gzipped = async (file: string) => {
  const known = sizes.get(file)
  if (known !== undefined) return known
  const size = Bun.gzipSync(await Bun.file(path.join(root, file)).bytes(), { level: 9 }).length
  sizes.set(file, size)
  return size
}
const closure = (key: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(key)) return seen
  seen.add(key)
  manifest[key].imports?.forEach((next) => closure(next, seen))
  return seen
}
const entry = closure("src/entry-client.tsx")
const pages = await Promise.all(
  Object.keys(manifest)
    .filter((key) => key.startsWith("src/routes/") && key.includes("?pick=default"))
    .map(async (key) => {
      const chunks = [...new Set([...entry, ...closure(key)])].map((chunk) => manifest[chunk].file)
      const bytes = (await Promise.all(chunks.map(gzipped))).reduce((sum, size) => sum + size, 0)
      return { route: key.slice("src/routes/".length).split("?")[0], kB: Math.round(bytes / 100) / 10 }
    }),
)
const over = pages.filter((page) => page.kB > budget)
if (over.length) {
  console.error(
    `check-client-bundle: initial JavaScript over the ${budget} kB (gzipped) budget:\n  ` +
      over.map((page) => `${page.route}: ${page.kB} kB`).join("\n  "),
  )
  process.exit(1)
}
const heaviest = pages.toSorted((a, b) => b.kB - a.kB)[0]
console.log(
  `check-client-bundle: every page's initial JavaScript is within ${budget} kB gzipped (heaviest ${heaviest.route}, ${heaviest.kB} kB)`,
)
