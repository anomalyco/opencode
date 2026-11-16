// Fails the build when a development tool reaches the browser bundle: Settings (settings-panel.tsx),
// Design mode (design-mode.tsx, design-overlay.tsx) or the device preview (device-preview.tsx,
// device-preview-panel.tsx). They load only on the development server, through loaders a production
// build compiles away: `import.meta.env.DEV ? lazy(() => import("./settings-panel")) : undefined`.
// Also fails when server-only code reaches it: the Worker's cache, GitHub calls and the build-time
// GitHub snapshot. Pages may import their modules for the queries, whose "use server" bodies the
// browser build drops along with everything only those bodies read.
// Last, it fails when the app's own scripts ship, or the one script every page loads passes its budget
// below. Code a page needs only later belongs behind a dynamic import.
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

// Production hydrates no page (src/static/render.tsx): every page loads the static pages' one script
// (src/client/entry.ts, script/static-client.ts), whose islands and overlays load later. The app's
// browser build is there for its stylesheets only, so none of its scripts may ship, and the script
// may bring no router, no serialized data (seroval) and no hydration. Its budget in kB, gzipped, is
// what it was when last measured, plus a kB of room; lower it when the script gets lighter.
const budget = 11.5
type Chunk = { file: string; imports?: string[] }
const app: Record<string, Chunk> = await Bun.file(path.join(root, ".vite/manifest.json")).json()
const statics: Record<string, Chunk> = await Bun.file(path.join(root, ".vite/static-manifest.json")).json()
const own = new Set(Object.values(statics).map((chunk) => chunk.file))
const shipped = (
  await Promise.all(
    Object.values(app)
      .filter((chunk) => /\.m?js$/.test(chunk.file) && !own.has(chunk.file))
      .map(async (chunk) => ((await Bun.file(path.join(root, chunk.file)).exists()) ? [chunk.file] : [])),
  )
).flat()
if (shipped.length) {
  console.error(`check-client-bundle: the app's scripts ship, though no page loads them:\n  ${shipped.join("\n  ")}`)
  process.exit(1)
}
const script = statics["src/client/entry.ts"]
if (script.imports?.length) {
  console.error(`check-client-bundle: the static pages' script imports ${script.imports.join(", ")}; keep it one file`)
  process.exit(1)
}
const bytes = await Bun.file(path.join(root, script.file)).bytes()
const text = new TextDecoder().decode(bytes)
// As they survive minification: the router's scroll key, seroval's errors, hydration's global.
const brought = ["solid-router", "Seroval", "_$HY"].filter((marker) => text.includes(marker))
if (brought.length) {
  console.error(`check-client-bundle: the static pages' script brings ${brought.join(", ")}`)
  process.exit(1)
}
const kB = Math.round(Bun.gzipSync(bytes, { level: 9 }).length / 100) / 10
if (!(kB <= budget)) {
  console.error(`check-client-bundle: the static pages' script is ${kB} kB gzipped, over its budget of ${budget} kB`)
  process.exit(1)
}
console.log(
  `check-client-bundle: the app ships no scripts; the static pages' script is ${kB} kB gzipped (budget ${budget})`,
)
