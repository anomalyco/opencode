// Fails the build when the Worker's server bundle can't start:
//
// - three.js (or any WebGL module) in it. Its module start-up creates an AbortController, which
//   Cloudflare Workers forbid during global start-up, so every page would answer 500. Browser-only
//   modules must be loaded with `import.meta.env.SSR ? undefined : () => import(...)` (see
//   test/server-bundle.test.ts).
// - Files that import each other. On 5 Nov the server chunk split into _ssr/ssr.mjs and ssr2.mjs, each
//   importing the other, and workerd refused to load it ("Export 'ssr_exports' is not defined").
//   vite.config.ts now builds the Worker as one file; this catches a cycle if splitting comes back.
//
// Run after `vite build`.
import path from "node:path"
import { Glob } from "bun"

const root = path.resolve(import.meta.dir, "..", ".output", "server")
// Declarations only three.js's own code contains (the client manifest still names its asset files,
// so file names are not evidence).
const markers = ["class WebGLRenderer", "class PMREMGenerator", "class BufferGeometry", "class Object3D"]

const files = await Array.fromAsync(new Glob("**/*.{mjs,js}").scan({ cwd: root }))
if (!files.length) {
  console.error(`check-server-bundle: no server output in ${root}; run vite build first`)
  process.exit(1)
}
const texts = new Map(
  await Promise.all(files.map(async (file) => [file, await Bun.file(path.join(root, file)).text()] as const)),
)
const found = files.flatMap((file) =>
  markers.filter((marker) => texts.get(file)!.includes(marker)).map((marker) => `${file}: ${marker}`),
)
if (found.length) {
  console.error("check-server-bundle: three.js/WebGL code is in the server bundle:\n  " + found.join("\n  "))
  process.exit(1)
}

// Each file's static imports of the bundle's other files (relative specifiers; dynamic import() is fine).
const imports = new Map(
  files.map((file) => [
    file,
    [...texts.get(file)!.matchAll(/^(?:import|export)\b[^;"']*?(?:from\s*)?["'](\.{1,2}\/[^"']+)["']/gm)].map((match) =>
      path.posix.join(path.posix.dirname(file), match[1]),
    ),
  ]),
)
const cycle = files.map((file) => cycleFrom(file, [file])).find(Boolean)
if (cycle) {
  console.error(
    `check-server-bundle: server files import each other, which workerd can't load:\n  ${cycle.join(" → ")}`,
  )
  process.exit(1)
}
console.log(`check-server-bundle: ${files.length} server files, no import cycles, no three.js/WebGL code`)

/** A path of static imports from `trail`'s last file back to its first, if there is one. */
function cycleFrom(start: string, trail: string[], seen = new Set<string>()): string[] | undefined {
  for (const next of imports.get(trail.at(-1)!) ?? []) {
    if (next === start) return [...trail, next]
    if (seen.has(next) || !imports.has(next)) continue
    seen.add(next)
    const found = cycleFrom(start, [...trail, next], seen)
    if (found) return found
  }
}
