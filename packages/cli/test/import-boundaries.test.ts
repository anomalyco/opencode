import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")

describe("CLI frontend import boundaries", () => {
  test("exposes only the run entrypoints from the run package export", async () => {
    const entrypoint = await import("@opencode-ai/cli/run")
    const mini = await import("@opencode-ai/cli/mini")

    expect(Object.keys(entrypoint).sort()).toEqual(["runNonInteractive", "runV1Bridge"])
    expect(Object.keys(mini).sort()).toEqual(["mergeInteractiveInput", "runMini", "validateMiniTerminal"])
  })

  test("keeps run and Mini handlers on separate leaf graphs", async () => {
    const run = await bundleInputs("src/commands/handlers/run.ts")
    expect(run).toContain("src/run/run.ts")
    expect(run).not.toContain("src/mini/mini.ts")
    expect(run).not.toContain("src/mini/runtime.ts")

    const mini = await bundleInputs("src/commands/handlers/mini.ts")
    expect(mini).toContain("src/mini/mini.ts")
    expect(mini).not.toContain("src/run/run.ts")
    expect(mini).not.toContain("src/run/noninteractive.ts")
    expect(mini).not.toContain("src/run/ui.ts")
  })
})

async function bundleInputs(entrypoint: string) {
  const temporary = await mkdtemp(path.join(import.meta.dir, ".import-boundary-"))
  const metafile = path.join(temporary, "meta.json")
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "build",
        entrypoint,
        "--target=bun",
        "--format=esm",
        "--packages=external",
        `--metafile=${metafile}`,
        `--outdir=${path.join(temporary, "out")}`,
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(stdout + stderr)
    const metadata = await Bun.file(metafile).json()
    return Object.keys(metadata.inputs).map((input) =>
      path.relative(root, path.resolve(root, input)).replaceAll(path.sep, "/"),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
