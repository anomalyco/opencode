import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

const directory = resolve(import.meta.dir, "..")
const effect = realpathSync(resolve(import.meta.dir, "../node_modules/effect"))
const schema = resolve(import.meta.dir, "../../schema")
const protocol = resolve(import.meta.dir, "../../protocol")
const core = resolve(import.meta.dir, "../../core")
const server = resolve(import.meta.dir, "../../server")

describe("public import boundaries", () => {
  test("isolates each public entrypoint", async () => {
    const root = await bundleInputs("@opencode-ai/client", "browser")

    expect(within(root.all, effect)).toEqual([])
    expect(within(root.all, schema)).toEqual([])
    expect(within(root.all, protocol)).toEqual([])
    expect(within(root.all, core)).toEqual([])
    expect(within(root.all, server)).toEqual([])

    const network = await bundleInputs("@opencode-ai/client/effect", "browser")

    expect(within(network.eager, effect).length).toBeGreaterThan(0)
    expect(within(network.eager, schema).length).toBeGreaterThan(0)
    expect(within(network.eager, protocol).length).toBeGreaterThan(0)
    expect(within(network.all, core)).toEqual([])
    expect(within(network.all, server)).toEqual([])

    const promiseService = await bundleInputs("@opencode-ai/client/service", "bun")

    expect(within(promiseService.all, effect)).toEqual([])
    expect(within(promiseService.all, schema)).toEqual([])
    expect(within(promiseService.all, protocol)).toEqual([])
    expect(within(promiseService.all, core)).toEqual([])
    expect(within(promiseService.all, server)).toEqual([])

    const effectService = await bundleInputs("@opencode-ai/client/effect/service", "bun")

    expect(within(effectService.eager, effect).length).toBeGreaterThan(0)
    expect(within(effectService.eager, protocol).length).toBeGreaterThan(0)
    expect(within(effectService.all, core)).toEqual([])
    expect(within(effectService.all, server)).toEqual([])
  })
})

async function bundleInputs(specifier: string, target: "browser" | "bun") {
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
    const metadata: {
      inputs: Record<string, { imports: Array<{ path: string; kind: string; external?: boolean }> }>
    } = await Bun.file(metafile).json()
    const inputs = new Map(Object.entries(metadata.inputs).map(([file, input]) => [resolve(directory, file), input]))
    const eager = new Set<string>()
    const visit = (file: string) => {
      if (eager.has(file)) return
      eager.add(file)
      inputs
        .get(file)
        ?.imports.filter((input) => !input.external && input.kind !== "dynamic-import")
        .forEach((input) => visit(resolve(directory, input.path)))
    }
    visit(entrypoint)
    return { all: Array.from(inputs.keys()), eager: Array.from(eager) }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function within(inputs: ReadonlyArray<string>, directory: string) {
  const prefix = directory.endsWith(sep) ? directory : directory + sep
  return inputs.filter((input) => input === directory || input.startsWith(prefix))
}
