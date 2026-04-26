import { expect, describe, it } from "bun:test"
import { Effect } from "effect"
import type { Interface as AstParserInterface } from "../../src/ast/parser"
import { Service as AstParserService, layer as AstParserLayer } from "../../src/ast/parser"
import * as path from "path"
import * as fs from "fs/promises"
import { tmpdir } from "os"

async function withParser<T>(fn: (parser: AstParserInterface) => Promise<T>): Promise<T> {
  const program = Effect.gen(function* () {
    const parser = yield* AstParserService
    return yield* Effect.promise(() => fn(parser))
  })
  return Effect.runPromise(Effect.provide(program, AstParserLayer))
}

async function writeTempFile(content: string, ext: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "ast-test-"))
  const filePath = path.join(dir, `test.${ext}`)
  await fs.writeFile(filePath, content, "utf-8")
  return filePath
}

describe("AstParser.parse", () => {
  it("parses TypeScript", async () => {
    const filePath = await writeTempFile("function hello() { return 1 }", "ts")
    const result = await withParser(async (parser) => {
      return await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
    })
    expect(result.language).toBe("typescript")
    expect(result.rootNode.type).toBe("program")
  }, 10000)

  it("parses Go", async () => {
    const filePath = await writeTempFile("package main\n\nfunc main() {}", "go")
    const result = await withParser(async (parser) => {
      return await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
    })
    expect(result.language).toBe("go")
    expect(result.rootNode.type).toBe("source_file")
  }, 10000)

  it("parses Python", async () => {
    const filePath = await writeTempFile("def hello():\n    return 1", "py")
    const result = await withParser(async (parser) => {
      return await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
    })
    expect(result.language).toBe("python")
    expect(result.rootNode.type).toBe("module")
  }, 10000)

  it("rejects unsupported file type", async () => {
    const filePath = await writeTempFile("hello", "txt")
    await expect(
      withParser(async (parser) => {
        return await Effect.runPromise(parser.parse(filePath, "hello"))
      }),
    ).rejects.toThrow("Unsupported file type")
  })
})

describe("AstParser.query", () => {
  it("finds function declarations in TypeScript", async () => {
    const filePath = await writeTempFile(
      "function hello() { return 1 }\nfunction world() { return 2 }",
      "ts",
    )
    const result = await withParser(async (parser) => {
      const parsed = await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
      return await Effect.runPromise(parser.query(parsed, "(function_declaration) @fn"))
    })
    expect(result.length).toBe(2)
    expect(result[0].node_type).toBe("function_declaration")
    expect(result[0].start_line).toBe(0)
    expect(result[1].start_line).toBe(1)
  }, 10000)

  it("finds class declarations in TypeScript", async () => {
    const filePath = await writeTempFile("class Foo {}\nclass Bar {}", "ts")
    const result = await withParser(async (parser) => {
      const parsed = await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
      return await Effect.runPromise(parser.query(parsed, "(class_declaration) @cls"))
    })
    expect(result.length).toBe(2)
    expect(result[0].node_type).toBe("class_declaration")
  }, 10000)

  it("returns empty array for no matches", async () => {
    const filePath = await writeTempFile("const x = 1", "ts")
    const result = await withParser(async (parser) => {
      const parsed = await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
      return await Effect.runPromise(parser.query(parsed, "(function_declaration) @fn"))
    })
    expect(result.length).toBe(0)
  }, 10000)
})

describe("AstParser.queryFile", () => {
  it("queries with auto-detected language", async () => {
    const filePath = await writeTempFile("func main() {}", "go")
    const result = await withParser(async (parser) => {
      return await Effect.runPromise(
        parser.queryFile(filePath, await fs.readFile(filePath, "utf-8"), "(function_declaration) @fn"),
      )
    })
    expect(result.length).toBe(1)
    expect(result[0].node_type).toBe("function_declaration")
  }, 10000)

  it("queries with explicit language override", async () => {
    const filePath = await writeTempFile("function hello() {}", "txt")
    const result = await withParser(async (parser) => {
      return await Effect.runPromise(
        parser.queryFile(filePath, await fs.readFile(filePath, "utf-8"), "(function_declaration) @fn", "typescript"),
      )
    })
    expect(result.length).toBe(1)
    expect(result[0].node_type).toBe("function_declaration")
  }, 10000)
})

describe("AstParser.nodeAtRange", () => {
  it("finds node at exact line range", async () => {
    const filePath = await writeTempFile("function hello() {\n  return 1\n}", "ts")
    const result = await withParser(async (parser) => {
      const parsed = await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
      return await Effect.runPromise(parser.nodeAtRange(parsed, 0, 2))
    })
    expect(result).not.toBeNull()
    expect(result!.node_type).toBe("statement_block")
  }, 10000)

  it("finds inner node for sub-range", async () => {
    const filePath = await writeTempFile("function hello() {\n  return 1\n}", "ts")
    const result = await withParser(async (parser) => {
      const parsed = await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
      return await Effect.runPromise(parser.nodeAtRange(parsed, 1, 1))
    })
    expect(result).not.toBeNull()
    expect(result!.node_type).toBe("return")
  }, 10000)

  it("returns null for out-of-range", async () => {
    const filePath = await writeTempFile("function hello() {}", "ts")
    const result = await withParser(async (parser) => {
      const parsed = await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
      return await Effect.runPromise(parser.nodeAtRange(parsed, 100, 200))
    })
    expect(result).toBeNull()
  }, 10000)
})

describe("QueryMatch fields", () => {
  it("includes name for named declarations", async () => {
    const filePath = await writeTempFile("function hello() { return 1 }", "ts")
    const result = await withParser(async (parser) => {
      const parsed = await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
      return await Effect.runPromise(parser.query(parsed, "(function_declaration) @fn"))
    })
    expect(result.length).toBe(1)
    expect(result[0].name).toBe("hello")
  }, 10000)

  it("includes char offsets", async () => {
    const filePath = await writeTempFile("function hello() {}", "ts")
    const result = await withParser(async (parser) => {
      const parsed = await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
      return await Effect.runPromise(parser.query(parsed, "(function_declaration) @fn"))
    })
    expect(result.length).toBe(1)
    expect(result[0].start_index).toBeGreaterThanOrEqual(0)
    expect(result[0].end_index).toBeGreaterThan(result[0].start_index)
  }, 10000)

  it("handles multi-byte UTF-8 correctly", async () => {
    const filePath = await writeTempFile('function 你好() { return "🎉" }', "ts")
    const result = await withParser(async (parser) => {
      const parsed = await Effect.runPromise(parser.parse(filePath, await fs.readFile(filePath, "utf-8")))
      return await Effect.runPromise(parser.query(parsed, "(function_declaration) @fn"))
    })
    expect(result.length).toBe(1)
    expect(result[0].name).toBe("你好")
    expect(result[0].end_index).toBeGreaterThan(result[0].start_index)
  }, 10000)
})
