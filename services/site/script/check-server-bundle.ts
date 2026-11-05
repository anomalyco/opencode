// Fails the build when three.js (or any WebGL module) reaches the Worker's server bundle. Its module
// start-up creates an AbortController, which Cloudflare Workers forbid during global start-up, so
// every page would answer 500. Run after `vite build`; browser-only modules must be loaded with
// `import.meta.env.SSR ? undefined : () => import(...)` (see test/server-bundle.test.ts).
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
const found = (
  await Promise.all(
    files.map(async (file) => {
      const text = await Bun.file(path.join(root, file)).text()
      return markers.filter((marker) => text.includes(marker)).map((marker) => `${file}: ${marker}`)
    }),
  )
).flat()
if (found.length) {
  console.error("check-server-bundle: three.js/WebGL code is in the server bundle:\n  " + found.join("\n  "))
  process.exit(1)
}
console.log(`check-server-bundle: ${files.length} server files, no three.js/WebGL code`)
