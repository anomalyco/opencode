import { resolve, dirname, join } from "path"
import { copyFileSync, mkdirSync } from "fs"

const dest = resolve(import.meta.dir, "../public")
mkdirSync(dest, { recursive: true })

// vad resolves to .bun/@ricky0123+vad-web@x.x.x/node_modules/@ricky0123/vad-web/dist/
// onnxruntime-web is a dep of vad-web, in the same node_modules tree
const vad = dirname(import.meta.resolve("@ricky0123/vad-web").replace("file://", ""))
// vad-web/dist → vad-web → @ricky0123 → node_modules → onnxruntime-web/dist
const ort = resolve(vad, "..", "..", "..", "onnxruntime-web", "dist")

const assets = [
  [join(vad, "silero_vad_legacy.onnx"), "silero_vad_legacy.onnx"],
  [join(vad, "vad.worklet.bundle.min.js"), "vad.worklet.bundle.min.js"],
  [join(ort, "ort-wasm-simd-threaded.mjs"), "ort-wasm-simd-threaded.mjs"],
  [join(ort, "ort-wasm-simd-threaded.wasm"), "ort-wasm-simd-threaded.wasm"],
] as const

for (const [src, name] of assets) {
  copyFileSync(src, join(dest, name))
  console.log(`copied ${name}`)
}
