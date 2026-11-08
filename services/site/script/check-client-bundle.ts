// Fails the build when a development tool reaches the browser bundle: Settings (settings-panel.tsx),
// Design mode (design-mode.tsx, design-overlay.tsx) or the device preview (device-preview.tsx,
// device-preview-panel.tsx). They load only on the development server, through loaders a production
// build compiles away: `import.meta.env.DEV ? lazy(() => import("./settings-panel")) : undefined`.
// Also fails when server-only code reaches it: the Worker's cache, GitHub calls and the build-time
// GitHub snapshot. Pages may import their modules for the queries, whose "use server" bodies the
// browser build drops along with everything only those bodies read.
// Last, it fails when a page's initial JavaScript (the entry and every chunk the page's route imports
// statically, which the server modulepreloads) passes its budget below, gzipped. Code a page needs
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

// Each page's budget in kB, gzipped: what it was when last measured, plus a kB of room. Lower a
// budget when a page gets lighter; a page without one fails until it has one.
const budgets: Record<string, number> = {
  "[...404].tsx": 104,
  "brand/index.tsx": 107,
  "changelog/[tag].tsx": 113,
  "changelog/index.tsx": 112,
  "desktop.tsx": 127.6,
  "devices.tsx": 51,
  "product/browse.tsx": 106,
  "font/index.tsx": 121,
  "ide.tsx": 127.6,
  "index.tsx": 118,
  "legal/index.tsx": 148,
  "legal/privacy-policy/index.tsx": 137,
  "legal/terms-of-service/index.tsx": 135,
  "mini.tsx": 127.6,
  "mobile.tsx": 127.6,
  "press/index.tsx": 112,
  "product/index.tsx": 114.7,
  "sdk.tsx": 127.6,
  "terminal.tsx": 127.6,
  "video-editor/index.tsx": 49,
}
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
const over = pages.filter((page) => !(page.kB <= budgets[page.route]))
if (over.length) {
  console.error(
    "check-client-bundle: initial JavaScript (gzipped) over its page's budget:\n  " +
      over.map((page) => `${page.route}: ${page.kB} kB, budget ${budgets[page.route] ?? "none"}`).join("\n  "),
  )
  process.exit(1)
}
console.log(
  "check-client-bundle: initial JavaScript within budget (kB gzipped): " +
    pages
      .toSorted((a, b) => b.kB - a.kB)
      .map((page) => `${page.route} ${page.kB}`)
      .join(", "),
)
