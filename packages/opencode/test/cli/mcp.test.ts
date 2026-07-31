import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { findMcpConfigFiles, removeMcpFromConfig } from "../../src/cli/cmd/mcp"
import { parse } from "jsonc-parser"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mcp-remove-test-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("removeMcpFromConfig", () => {
  test("removes the named server and keeps other entries", async () => {
    const file = path.join(dir, "aixplainCode.json")
    await writeFile(
      file,
      JSON.stringify({
        mcp: {
          one: { type: "remote", url: "https://one.example.com/mcp" },
          two: { type: "local", command: ["aiXplain", "x", "server-two"] },
        },
      }),
    )

    expect(await removeMcpFromConfig("one", file)).toBe("removed")

    const result = JSON.parse(await readFile(file, "utf8"))
    expect(result.mcp).toEqual({ two: { type: "local", command: ["aiXplain", "x", "server-two"] } })
  })

  test("preserves comments in jsonc files", async () => {
    const file = path.join(dir, "aixplainCode.jsonc")
    await writeFile(
      file,
      `{
  // keep this comment
  "mcp": {
    // server one
    "one": { "type": "remote", "url": "https://one.example.com/mcp" },
    "two": { "type": "local", "command": ["run", "two"] }
  }
}
`,
    )

    expect(await removeMcpFromConfig("one", file)).toBe("removed")

    const text = await readFile(file, "utf8")
    expect(text).toContain("keep this comment")
    expect(text).not.toContain("one.example.com")
  })

  test("returns false when the server is not in the file", async () => {
    const file = path.join(dir, "aixplainCode.json")
    const text = JSON.stringify({ mcp: { other: { type: "remote", url: "https://x" } } })
    await writeFile(file, text)

    expect(await removeMcpFromConfig("missing", file)).toBe("not_found")
    expect(await readFile(file, "utf8")).toBe(text)
  })

  test("returns false when the file does not exist", async () => {
    expect(await removeMcpFromConfig("one", path.join(dir, "nope.json"))).toBe("not_found")
  })

  test("refuses to write when removal would produce invalid jsonc (dangling comma)", async () => {
    const file = path.join(dir, "aixplainCode.jsonc")
    const text = `{ "mcp": { "one": { "type": "remote", "url": "https://one.example.com/mcp" }, } }`
    await writeFile(file, text)

    expect(await removeMcpFromConfig("one", file)).toBe("invalid")
    expect(await readFile(file, "utf8")).toBe(text)
  })

  test("removes the only entry from a valid jsonc file with a trailing comma elsewhere tolerated", async () => {
    const file = path.join(dir, "aixplainCode.jsonc")
    await writeFile(file, `{ "mcp": { "one": { "url": "https://one" }, "two": { "url": "https://two" }, } }`)

    expect(await removeMcpFromConfig("one", file)).toBe("removed")
    const parsed = parse(await readFile(file, "utf8"), undefined, { allowTrailingComma: true })
    expect(parsed.mcp).toEqual({ two: { url: "https://two" } })
  })
})

describe("findMcpConfigFiles", () => {
  test("returns only files that define the server", async () => {
    const withServer = path.join(dir, "aixplainCode.json")
    const without = path.join(dir, "aixplainCode.jsonc")
    const nested = path.join(dir, ".aixplain-code", "aixplainCode.json")
    await writeFile(withServer, JSON.stringify({ mcp: { one: {} } }))
    await writeFile(without, JSON.stringify({ mcp: { other: {} } }))
    await mkdir(path.dirname(nested), { recursive: true })
    await writeFile(nested, JSON.stringify({ mcp: { one: {} } }))

    const found = await findMcpConfigFiles("one", [withServer, without, path.join(dir, "missing.json"), nested])
    expect(found).toEqual([withServer, nested])
  })
})
