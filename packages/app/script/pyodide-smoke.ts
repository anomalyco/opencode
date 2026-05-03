/**
 * Uses the same Pyodide helpers as the browser (`src/lib/pyodide-core.ts`).
 * Node/Bun: local `pyodide` package artifacts (no CDN). Browser: `run-pyodide` uses CDN.
 *
 * Run from packages/app: `bun run smoke:pyodide`
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  installVeritlyUniverSdkFromSource,
  loadPyodideWithIndex,
  runCapturedPython,
} from "../src/lib/pyodide-core"

const req = createRequire(import.meta.url)
const indexURL = join(dirname(req.resolve("pyodide/pyodide.js")), "/")

const here = dirname(fileURLToPath(import.meta.url))
const sdkPath = join(here, "../../univer-sdk/python/veritly_univer_sdk.py")

async function main() {
  console.log("indexURL", indexURL)
  const py = await loadPyodideWithIndex(indexURL)
  const sum = await py.runPythonAsync("1+1")
  console.log("1+1 =>", sum)

  const nest = await runCapturedPython(
    py,
    "async def main():\n    async def f():\n        return 7\n    print(await f())\n",
    30_000,
  )
  if (nest.exitCode !== 0) throw new Error(`async main() smoke: ${nest.output}`)

  const sdkSource = readFileSync(sdkPath, "utf-8")
  await installVeritlyUniverSdkFromSource(py, { source: sdkSource })
  const probe = await runCapturedPython(py, "from veritly_univer_sdk import UniverSDK; print(UniverSDK.__name__)", 30_000)
  if (probe.exitCode !== 0) throw new Error(probe.output)
  if (!probe.output.includes("UniverSDK")) throw new Error(`unexpected: ${JSON.stringify(probe.output)}`)

  const out = await runCapturedPython(py, "print(42)", 30_000)
  if (out.exitCode !== 0) throw new Error(`expected exit 0, got ${out.exitCode}: ${out.output}`)
  if (!out.output.includes("42")) throw new Error(`expected 42 in stdout, got ${JSON.stringify(out.output)}`)
  console.log("ok: load + install veritly_univer_sdk + runCapturedPython (shared core)")
}

await main()
