// Fails the build when a development tool reaches the browser bundle: Settings (settings-panel.tsx),
// Design mode (design-mode.tsx, design-overlay.tsx) or the device preview (device-preview.tsx,
// device-preview-panel.tsx). They load only on the development server, through loaders a production
// build compiles away: `import.meta.env.DEV ? lazy(() => import("./settings-panel")) : undefined`.
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
]
// The tools' styles (settings-panel.css, design-mode.css, device-preview.css).
const styleMarker =
  /\[data-component="?(settings-panel|settings-backdrop|design-overlay|design-controls|design-export|history-toast|device-preview)"?\]/
// Chunks named after the tools' modules.
const chunkName =
  /(^|\/)(design-mode|design-overlay|settings-panel|device-preview|device-preview-panel|page-settings|settings-transfer)-[\w-]+\.(js|css)$/

const files = await Array.fromAsync(new Glob("**/*.{js,mjs,css}").scan({ cwd: root }))
if (!files.length) {
  console.error(`check-client-bundle: no client output in ${root}; run vite build first`)
  process.exit(1)
}
const found = (
  await Promise.all(
    files.map(async (file) => {
      if (chunkName.test(file)) return [`${file}: a development tool's chunk`]
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
    "check-client-bundle: Settings, Design mode or device preview code is in the client bundle:\n  " +
      found.join("\n  "),
  )
  process.exit(1)
}
console.log(`check-client-bundle: ${files.length} client files, no Settings, Design mode or device preview code`)
