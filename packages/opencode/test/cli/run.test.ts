import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { parseSchema } from "../../src/cli/cmd/run"

describe("run.parseSchema", () => {
  test("parses inline schema", async () => {
    const result = await parseSchema('{"type":"object","properties":{"ok":{"type":"boolean"}}}')
    expect(result).toEqual({
      type: "object",
      properties: {
        ok: {
          type: "boolean",
        },
      },
    })
  })

  test("parses schema file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-run-schema-"))
    const file = path.join(dir, "schema.json")
    await fs.writeFile(file, '{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}')
    const result = await parseSchema(file)
    expect(result).toEqual({
      type: "object",
      required: ["id"],
      properties: {
        id: {
          type: "string",
        },
      },
    })
    await fs.rm(dir, { recursive: true, force: true })
  })

  test("rejects non-object schema", async () => {
    await expect(parseSchema("[]")).rejects.toThrow("Schema must be a JSON object")
  })

  test("rejects invalid input", async () => {
    await expect(parseSchema("{bad")).rejects.toThrow("Invalid schema")
  })
})
