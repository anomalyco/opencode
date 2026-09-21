import { rm } from "node:fs/promises"
import path from "node:path"

export const packageRoot = path.resolve(import.meta.dir, "..")
export const distDirectory = path.join(packageRoot, "dist")

const entrypoints = [path.join(packageRoot, "src/plugin.ts"), path.join(packageRoot, "src/contract.ts")]

export async function buildPackage(): Promise<void> {
  await rm(distDirectory, { recursive: true, force: true })
  const bundle = await Bun.build({
    entrypoints,
    outdir: distDirectory,
    target: "node",
    format: "esm",
    packages: "external",
  })
  if (!bundle.success) throw new AggregateError(bundle.logs, "superpowers-execution bundle failed")

  const declarations = Bun.spawnSync(
    [process.execPath, path.join(packageRoot, "node_modules/@typescript/native-preview/bin/tsgo.js"), "-p", "tsconfig.build.json"],
    { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
  )
  if (declarations.exitCode !== 0) {
    throw new Error(`superpowers-execution declarations failed: ${declarations.stderr.toString()}`)
  }
}

if (import.meta.main) await buildPackage()
