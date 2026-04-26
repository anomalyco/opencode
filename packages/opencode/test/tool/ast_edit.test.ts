import { afterAll, afterEach, describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer, ManagedRuntime } from "effect"
import { AstEditTool } from "../../src/tool/ast_edit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { LSP } from "../../src/lsp"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Truncate } from "../../src/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import { AstParser } from "../../src/ast/parser"

const ctx = {
  sessionID: SessionID.make("ses_test-ast-edit-session"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    LSP.defaultLayer,
    AppFileSystem.defaultLayer,
    Format.defaultLayer,
    Bus.layer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    AstParser.defaultLayer,
  ),
)

afterAll(async () => {
  await runtime.dispose()
})

const resolve = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* AstEditTool
      const def = yield* info.init()
      return def
    }),
  )

describe("AstEditTool", () => {
  test("replaces a single matched node", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await fs.writeFile(
      file,
      `function hello() {\n  console.log("hello")\n}\n\nfunction goodbye() {\n  console.log("goodbye")\n}\n`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const def = await resolve()
        const result = await runtime.runPromise(
          def.execute(
            {
              filePath: file,
              pattern: '(function_declaration name: (identifier) @name (#eq? @name "hello")) @fn',
              newContent: 'function hello() {\n  console.log("hello, world!")\n}',
            },
            ctx as any,
          ),
        )

        expect(result.title).toContain("ast_edit")
        expect(result.title).toContain("test.ts")
        expect(result.output).toContain("Edit applied")

        const updated = await fs.readFile(file, "utf-8")
        expect(updated).toContain('console.log("hello, world!")')
        expect(updated).not.toContain('console.log("hello")')
        expect(updated).toContain('console.log("goodbye")')
      },
    })
  }, 30000)

  test("returns error when no node matches", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await fs.writeFile(file, `function foo() {}\n`)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const def = await resolve()
        const result = await runtime.runPromise(
          def.execute(
            {
              filePath: file,
              pattern: '(class_declaration) @cls',
              newContent: "class New {}",
            },
            ctx as any,
          ),
        )

        expect(result.title).toContain("no match")
        expect(result.output).toContain("No node matched pattern")
      },
    })
  }, 30000)

  test("returns error when pattern matches more than one node", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await fs.writeFile(
      file,
      `function one() {}\nfunction two() {}\n`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const def = await resolve()
        const result = await runtime.runPromise(
          def.execute(
            {
              filePath: file,
              pattern: "(function_declaration) @fn",
              newContent: "function replaced() {}",
            },
            ctx as any,
          ),
        )

        expect(result.title).toContain("ambiguous match")
        expect(result.output).toContain("Pattern matched 2 nodes")
      },
    })
  }, 30000)

  test("handles UTF-8 content correctly", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.ts")
    await fs.writeFile(
      file,
      `function emoji() {\n  return "🚀🚀🚀"\n}\n`,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const def = await resolve()
        const result = await runtime.runPromise(
          def.execute(
            {
              filePath: file,
              pattern: '(function_declaration name: (identifier) @name (#eq? @name "emoji")) @fn',
              newContent: 'function emoji() {\n  return "✨✨✨"\n}',
            },
            ctx as any,
          ),
        )

        expect(result.output).toContain("Edit applied")
        const updated = await fs.readFile(file, "utf-8")
        expect(updated).toContain("✨✨✨")
        expect(updated).not.toContain("🚀🚀🚀")
      },
    })
  }, 30000)
})
