import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")
const mcp = "packages/core/src/mcp/index.ts"
// Every built-in plugin loads at Location startup, whether or not any MCP server is configured.
const plugins = "packages/core/src/plugin/internal.ts"

test("loads the MCP SDK only when connecting or authorizing", async () => {
  const temporary = await mkdtemp(path.join(import.meta.dir, ".mcp-import-boundary-"))
  const metafile = path.join(temporary, "meta.json")
  try {
    const result = Bun.spawn(
      [
        process.execPath,
        "build",
        mcp,
        plugins,
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

    const metadata: Metafile = await Bun.file(metafile).json()
    const lazy = metadata.inputs[mcp].imports.filter(
      (item) => item.original === "./client.js" || item.original === "./oauth.js",
    )
    expect(new Set(lazy.map((item) => item.original))).toEqual(new Set(["./client.js", "./oauth.js"]))
    expect(lazy.every((item) => item.kind === "dynamic-import")).toBe(true)
    expect(sdkChain(metadata, mcp)).toBeUndefined()
    expect(sdkChain(metadata, plugins)).toBeUndefined()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

type Metafile = {
  inputs: Record<string, { imports: ReadonlyArray<{ path: string; kind: string; original?: string }> }>
}

// The static import chain from entry to the first MCP SDK module it loads, or undefined when it loads none.
function sdkChain(metadata: Metafile, entry: string) {
  const parents = new Map<string, string | undefined>([[entry, undefined]])
  const pending = [entry]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.includes("@modelcontextprotocol")) {
      const chain = [current]
      while (parents.get(chain[0]!)) chain.unshift(parents.get(chain[0]!)!)
      return chain
    }
    for (const item of metadata.inputs[current]?.imports ?? []) {
      if (item.kind === "dynamic-import" || parents.has(item.path)) continue
      parents.set(item.path, current)
      pending.push(item.path)
    }
  }
  return undefined
}
