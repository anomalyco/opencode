import { describe, expect, test } from "bun:test"
import path from "path"
import { parseSchema } from "../../src/cli/cmd/run"
import { tmpdir } from "../fixture/fixture"

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
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "schema.json")
    await Bun.write(file, '{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}')
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
  })

  test("rejects non-object schema", async () => {
    await expect(parseSchema("[]")).rejects.toThrow("Schema must be a JSON object")
  })

  test("rejects invalid input", async () => {
    await expect(parseSchema("{bad")).rejects.toThrow("Invalid schema")
  })
})
