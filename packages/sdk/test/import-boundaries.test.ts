import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

const directory = resolve(import.meta.dir, "..")
const client = resolve(import.meta.dir, "../../client")
const core = resolve(import.meta.dir, "../../core")
const server = resolve(import.meta.dir, "../../server")

test("bundles the Promise and Effect clients with the in-memory host", async () => {
  const bundles = await Promise.all([bundleInputs("@opencode-ai/sdk"), bundleInputs("@opencode-ai/sdk/effect")])

  for (const inputs of bundles) {
    expect(within(inputs, client).length).toBeGreaterThan(0)
    expect(within(inputs, core).length).toBeGreaterThan(0)
    expect(within(inputs, server).length).toBeGreaterThan(0)
  }
})

async function bundleInputs(specifier: string) {
  const temporary = await mkdtemp(join(import.meta.dir, ".import-boundary-"))
  const entrypoint = join(temporary, "index.ts")
  const metafile = join(temporary, "meta.json")
  try {
    await Bun.write(entrypoint, `export * from ${JSON.stringify(specifier)}`)
    const child = Bun.spawn(
      [
        process.execPath,
        "build",
        entrypoint,
        "--target=bun",
        "--format=esm",
        "--packages=bundle",
        `--metafile=${metafile}`,
        `--outdir=${join(temporary, "out")}`,
      ],
      { cwd: directory, stdout: "pipe", stderr: "pipe" },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(stdout + stderr)
    const metadata = await Bun.file(metafile).json()
    return Object.keys(metadata.inputs).map((input) => resolve(directory, input))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function within(inputs: ReadonlyArray<string>, directory: string) {
  const prefix = directory.endsWith(sep) ? directory : directory + sep
  return inputs.filter((input) => input === directory || input.startsWith(prefix))
}
