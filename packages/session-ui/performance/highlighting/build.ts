import { build } from "vite"
import solid from "vite-plugin-solid"
import path from "node:path"
import { realpathSync } from "node:fs"
import { createHash } from "node:crypto"

const outDir = process.env.HIGHLIGHT_BUNDLE
if (!outDir) throw new Error("Set HIGHLIGHT_BUNDLE to an external artifact directory")
const ui = realpathSync(path.resolve(import.meta.dir, "../../node_modules/@opencode-ai/ui"))
if (ui !== realpathSync(path.resolve(import.meta.dir, "../../../ui"))) throw new Error(`Wrong workspace source: ${ui}`)
const util = realpathSync(path.resolve(import.meta.dir, "../../node_modules/@opencode-ai/util"))
if (util !== realpathSync(path.resolve(import.meta.dir, "../../../util"))) throw new Error(`Wrong workspace source: ${util}`)
await build({
  configFile: false,
  logLevel: "warn",
  root: import.meta.dir,
  plugins: [solid()],
  build: { outDir, emptyOutDir: true, sourcemap: true },
  worker: { format: "es" },
})
const files = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: outDir, onlyFiles: true }))
const hash = createHash("sha256")
for (const file of files.sort()) hash.update(file).update(new Uint8Array(await Bun.file(path.join(outDir, file)).arrayBuffer()))
await Bun.write(path.join(outDir, "build.json"), JSON.stringify({
  revision: Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim(),
  sourceDiff: Bun.spawnSync(["git", "diff", "--", "src/components/session-diff.ts", "src/components/file.tsx", "src/pierre/worker.ts"]).stdout.toString(),
  bundle: hash.digest("hex"), bun: Bun.version, ui, util,
}, null, 2))
