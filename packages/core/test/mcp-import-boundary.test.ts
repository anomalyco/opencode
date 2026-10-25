import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")

test("loads the MCP SDK only when connecting or authorizing", async () => {
  const temporary = await mkdtemp(path.join(import.meta.dir, ".mcp-import-boundary-"))
  const metafile = path.join(temporary, "meta.json")
  try {
    const result = Bun.spawn(
      [
        process.execPath,
        "build",
        "packages/core/src/mcp/index.ts",
        "--target=node",
        "--format=esm",
        "--packages=bundle",
        "--splitting",
        `--metafile=${metafile}`,
        `--outdir=${path.join(temporary, "out")}`,
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      result.exited,
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(stdout + stderr)

    const metadata = await Bun.file(metafile).json()
    const imports = metadata.inputs["packages/core/src/mcp/index.ts"].imports
    const lazy = imports.filter(
      (item: { original?: string }) => item.original === "./client.js" || item.original === "./oauth.js",
    )
    expect(new Set(lazy.map((item: { original: string }) => item.original))).toEqual(
      new Set(["./client.js", "./oauth.js"]),
    )
    expect(lazy.every((item: { kind: string }) => item.kind === "dynamic-import")).toBe(true)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
