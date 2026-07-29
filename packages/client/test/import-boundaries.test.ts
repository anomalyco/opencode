import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

const directory = resolve(import.meta.dir, "..")
const effect = realpathSync(resolve(import.meta.dir, "../node_modules/effect"))
const ws = realpathSync(resolve(import.meta.dir, "../node_modules/ws"))
const schema = resolve(import.meta.dir, "../../schema")
const protocol = resolve(import.meta.dir, "../../protocol")
const core = resolve(import.meta.dir, "../../core")
const server = resolve(import.meta.dir, "../../server")

describe("public import boundaries", () => {
  test("isolates each public entrypoint", async () => {
    const root = await bundleInputs("@opencode-ai/client", "browser")

    expect(within(root, effect)).toEqual([])
    expect(within(root, schema)).toEqual([])
    expect(within(root, protocol)).toEqual([])
    expect(within(root, ws)).toEqual([])
    expect(within(root, core)).toEqual([])
    expect(within(root, server)).toEqual([])

    const network = await bundleInputs("@opencode-ai/client/effect", "browser")

    expect(within(network, effect).length).toBeGreaterThan(0)
    expect(within(network, schema).length).toBeGreaterThan(0)
    expect(within(network, protocol).length).toBeGreaterThan(0)
    expect(within(network, core)).toEqual([])
    expect(within(network, server)).toEqual([])

    const node = await bundleInputs("@opencode-ai/client/node", "node")

    expect(within(node, effect).length).toBeGreaterThan(0)
    expect(within(node, schema).length).toBeGreaterThan(0)
    expect(within(node, protocol).length).toBeGreaterThan(0)
    expect(within(node, ws).length).toBeGreaterThan(0)
    expect(within(node, core)).toEqual([])
    expect(within(node, server)).toEqual([])

    const promiseService = await bundleInputs("@opencode-ai/client/service", "bun")

    expect(within(promiseService, effect)).toEqual([])
    expect(within(promiseService, schema)).toEqual([])
    expect(within(promiseService, protocol)).toEqual([])
    expect(within(promiseService, core)).toEqual([])
    expect(within(promiseService, server)).toEqual([])

    const effectService = await bundleInputs("@opencode-ai/client/effect/service", "bun")

    expect(within(effectService, effect).length).toBeGreaterThan(0)
    expect(within(effectService, protocol).length).toBeGreaterThan(0)
    expect(within(effectService, core)).toEqual([])
    expect(within(effectService, server)).toEqual([])
  })
})

async function bundleInputs(specifier: string, target: "browser" | "bun" | "node") {
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
        `--target=${target}`,
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
