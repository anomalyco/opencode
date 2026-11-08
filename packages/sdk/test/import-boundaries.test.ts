import { expect, test } from "bun:test"
import { join, resolve, sep } from "node:path"

const directory = resolve(import.meta.dir, "..")
const client = resolve(import.meta.dir, "../../client")
const core = resolve(import.meta.dir, "../../core")
const server = resolve(import.meta.dir, "../../server")

// One in-process build parses the shared graph once and keeps entries and output in memory: two `bun build` children,
// each writing a 23 MB bundle to disk, ran past 5s on loaded Windows runners. The build still parses and links about
// 2,600 source files, hence the longer timeout.
test("bundles the Promise and Effect clients with the in-memory host", async () => {
  const bundles = await Promise.all([bundleInputs("@Mackery6969/sdk"), bundleInputs("@Mackery6969/sdk/effect")])

  for (const output of outputs) {
    // Metafile paths are relative to the working directory.
    const inputs = Object.keys(output.inputs).map((input) => resolve(input))
    expect(within(inputs, client).length).toBeGreaterThan(0)
    expect(within(inputs, core).length).toBeGreaterThan(0)
    expect(within(inputs, server).length).toBeGreaterThan(0)
  }
}, 15_000)

function within(inputs: ReadonlyArray<string>, directory: string) {
  const prefix = directory.endsWith(sep) ? directory : directory + sep
  return inputs.filter((input) => input === directory || input.startsWith(prefix))
}
