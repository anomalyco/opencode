import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { FilePathInput } from "../src/schema"

const decode = (input: unknown) => Schema.decodeUnknownSync(FilePathInput())(input)

describe("FilePathInput", () => {
  test("plain string passes through unchanged", () => {
    expect(decode("/Users/x/proj/notes.md")).toBe("/Users/x/proj/notes.md")
  })

  test("degenerate auto-link (text == url-without-protocol) is unwrapped", () => {
    expect(decode("[notes.md](http://notes.md)")).toBe("notes.md")
    expect(decode("[notes.md](https://notes.md)")).toBe("notes.md")
    expect(decode("[notes.md](notes.md)")).toBe("notes.md")
  })

  test("real markdown link (text != url-without-protocol) is preserved", () => {
    expect(decode("[click](https://example.com)")).toBe("[click](https://example.com)")
    expect(decode("[home](https://x.com)")).toBe("[home](https://x.com)")
  })

  test("embedded degenerate auto-link inside a longer path is unwrapped in place", () => {
    expect(decode("/Users/x/proj/[notes.md](http://notes.md)")).toBe("/Users/x/proj/notes.md")
  })

  test("embedded real markdown link inside a longer string is preserved", () => {
    expect(decode("see [click](https://example.com) for more")).toBe("see [click](https://example.com) for more")
  })

  test("non-string input is rejected by the underlying String schema", () => {
    const result = Schema.decodeUnknownResult(FilePathInput())(123)
    expect(result._tag).toBe("Failure")
  })

  test("description annotation lands on the encoded side (JSON Schema-visible)", () => {
    const schema = FilePathInput({ description: "path to read" })
    const wrapped = Schema.Struct({ p: schema })
    const json = Schema.toJsonSchemaDocument(wrapped, { additionalProperties: true })
    const prop = (json.schema as any).properties.p
    expect(prop.description).toBe("path to read")
  })
})
