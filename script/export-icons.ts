#!/usr/bin/env bun
/**
 * Export every opencode UI icon as a standalone SVG plus a browsable HTML
 * preview page. Run from the repository root:
 *
 *   bun run script/export-icons.ts
 *
 * Output defaults to ~/Desktop/opencode-icons and can be overridden with the
 * OPENCODE_ICONS_OUT environment variable.
 */
import { mkdir, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const ICON_FILE = "packages/ui/src/icons/icon/icon.tsx"
const ADDITIONAL_FILE = "packages/ui/src/icons/icon/additional-icons.ts"

const out = process.env.OPENCODE_ICONS_OUT ?? join(homedir(), "Desktop", "opencode-icons")

type Icon = { name: string; viewBox: string; body: string }

// Icons in icon.tsx are objects: `name: { viewBox: "...", body: \`...\` }`.
function parseStructured(source: string): Icon[] {
  const icons: Icon[] = []
  const re = /^\s{2}"?([a-zA-Z0-9_-]+)"?:\s*\{\s*\n\s*viewBox:\s*"([^"]+)",\s*\n\s*body:\s*`([\s\S]*?)`,\s*\n\s*\}/gm
  for (const match of source.matchAll(re)) {
    icons.push({ name: match[1], viewBox: match[2], body: match[3].trim() })
  }
  return icons
}

// Icons in additional-icons.ts are plain strings: `name: \`...\``.
function parseFlat(source: string, viewBox: string): Icon[] {
  const icons: Icon[] = []
  const re = /^\s{2}"?([a-zA-Z0-9_-]+)"?:\s*`([\s\S]*?)`,\s*$/gm
  for (const match of source.matchAll(re)) {
    icons.push({ name: match[1], viewBox, body: match[2].trim() })
  }
  return icons
}

// additional-icons.ts splits viewBox by a fixed allowlist; mirror it so exported
// SVGs match what the app renders.
const SMALL_VIEWBOX = new Set([
  "magnifying-glass",
  "arrow-undo-down",
  "subagent",
  "notifications",
  "appearance",
  "extensions",
  "sliders",
  "providers",
  "models",
])

function svg(icon: Icon) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="${icon.viewBox}" fill="none">${icon.body}</svg>\n`
}

function preview(icons: Icon[]) {
  const cards = icons
    .map(
      (icon) => `      <figure class="card">
        <div class="glyph">${svg(icon).trim()}</div>
        <figcaption>${icon.name}</figcaption>
      </figure>`,
    )
    .join("\n")
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>opencode icons (${icons.length})</title>
    <style>
      :root { color-scheme: light dark; --fg: #1a1a1a; --bg: #ffffff; --muted: #6b6b6b; --line: #e6e6e6; --hover: #f5f5f5; }
      @media (prefers-color-scheme: dark) {
        :root { --fg: #e6e6e6; --bg: #141414; --muted: #9a9a9a; --line: #2a2a2a; --hover: #1f1f1f; }
      }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
      header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
      h1 { font-size: 15px; font-weight: 600; margin: 0; }
      .hint { color: var(--muted); }
      input { width: 100%; max-width: 320px; padding: 6px 10px; margin-bottom: 20px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
      .card { margin: 0; padding: 16px 8px 10px; border: 1px solid var(--line); border-radius: 10px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
      .card:hover { background: var(--hover); }
      .glyph { color: var(--fg); display: flex; }
      .glyph svg { width: 28px; height: 28px; }
      figcaption { font-size: 11px; color: var(--muted); text-align: center; word-break: break-word; }
    </style>
  </head>
  <body>
    <header>
      <h1>opencode icons</h1>
      <span class="hint">${icons.length} icons</span>
    </header>
    <input id="filter" type="search" placeholder="Filter by name..." autofocus />
    <div class="grid" id="grid">
${cards}
    </div>
    <script>
      const filter = document.getElementById("filter")
      const cards = Array.from(document.querySelectorAll(".card"))
      filter.addEventListener("input", () => {
        const q = filter.value.trim().toLowerCase()
        for (const card of cards) {
          const name = card.querySelector("figcaption").textContent.toLowerCase()
          card.style.display = name.includes(q) ? "" : "none"
        }
      })
    </script>
  </body>
</html>
`
}

const structured = parseStructured(await Bun.file(ICON_FILE).text())
const flat = parseFlat(await Bun.file(ADDITIONAL_FILE).text(), "0 0 20 20").map((icon) =>
  SMALL_VIEWBOX.has(icon.name) ? { ...icon, viewBox: "0 0 16 16" } : icon,
)

// icon.tsx wins on duplicate names because it renders first in the app.
const merged = new Map<string, Icon>()
for (const icon of flat) merged.set(icon.name, icon)
for (const icon of structured) merged.set(icon.name, icon)
const icons = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))

await rm(out, { recursive: true, force: true })
await mkdir(join(out, "svg"), { recursive: true })
for (const icon of icons) {
  await writeFile(join(out, "svg", `${icon.name}.svg`), svg(icon))
}
await writeFile(join(out, "index.html"), preview(icons))

console.log(`exported ${icons.length} icons to ${out}`)
console.log(`  ${out}/index.html  (preview page)`)
console.log(`  ${out}/svg/*.svg   (standalone files)`)
