import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { AppFileSystem } from "../../src/filesystem"
import { FileTime } from "../../src/file/time"
import { Bus } from "../../src/bus"
import { Format } from "../../src/format"
import { Tool } from "../../src/tool/tool"
import { SessionID, MessageID } from "../../src/session/schema"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-write-session"),
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

const it = testEffect(
  Layer.mergeAll(
    LSP.defaultLayer,
    AppFileSystem.defaultLayer,
    FileTime.defaultLayer,
    Bus.layer,
    Format.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

const init = Effect.fn("WriteToolTest.init")(function* () {
  const info = yield* WriteTool
  return yield* Effect.promise(() => info.init())
})

const run = Effect.fn("WriteToolTest.run")(function* (
  args: Tool.InferParameters<typeof WriteTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

const markRead = Effect.fn("WriteToolTest.markRead")(function* (sessionID: string, filepath: string) {
  const ft = yield* FileTime.Service
  yield* ft.read(sessionID as any, filepath)
})

describe("tool.write", () => {
  describe("new file creation", () => {
    it.live("writes content to new file", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "newfile.txt")
          const result = yield* run({ filePath: filepath, content: "Hello, World!" })

          expect(result.output).toContain("Wrote file successfully")
          expect(result.metadata.exists).toBe(false)

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe("Hello, World!")
        }),
      ),
    )

    it.live("creates parent directories if needed", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "nested", "deep", "file.txt")
          yield* run({ filePath: filepath, content: "nested content" })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe("nested content")
        }),
      ),
    )

    it.live("handles relative paths by resolving to instance directory", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          yield* run({ filePath: "relative.txt", content: "relative content" })

          const content = yield* Effect.promise(() => fs.readFile(path.join(dir, "relative.txt"), "utf-8"))
          expect(content).toBe("relative content")
        }),
      ),
    )
  })

  describe("existing file overwrite", () => {
    it.live("overwrites existing file content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "existing.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "old content", "utf-8"))
          yield* markRead(ctx.sessionID, filepath)

          const result = yield* run({ filePath: filepath, content: "new content" })

          expect(result.output).toContain("Wrote file successfully")
          expect(result.metadata.exists).toBe(true)

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe("new content")
        }),
      ),
    )

    it.live("returns diff in metadata for existing files", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "file.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "old", "utf-8"))
          yield* markRead(ctx.sessionID, filepath)

          const result = yield* run({ filePath: filepath, content: "new" })

          expect(result.metadata).toHaveProperty("filepath", filepath)
          expect(result.metadata).toHaveProperty("exists", true)
        }),
      ),
    )
  })

  describe("file permissions", () => {
    it.live("sets file permissions when writing sensitive data", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "sensitive.json")
          yield* run({ filePath: filepath, content: JSON.stringify({ secret: "data" }) })

          if (process.platform !== "win32") {
            const stats = yield* Effect.promise(() => fs.stat(filepath))
            expect(stats.mode & 0o777).toBe(0o644)
          }
        }),
      ),
    )
  })

  describe("content types", () => {
    it.live("writes JSON content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "data.json")
          const data = { key: "value", nested: { array: [1, 2, 3] } }
          yield* run({ filePath: filepath, content: JSON.stringify(data, null, 2) })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(JSON.parse(content)).toEqual(data)
        }),
      ),
    )

    it.live("writes binary-safe content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "binary.bin")
          const content = "Hello\x00World\x01\x02\x03"
          yield* run({ filePath: filepath, content })

          const buf = yield* Effect.promise(() => fs.readFile(filepath))
          expect(buf.toString()).toBe(content)
        }),
      ),
    )

    it.live("writes empty content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "empty.txt")
          yield* run({ filePath: filepath, content: "" })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe("")

          const stats = yield* Effect.promise(() => fs.stat(filepath))
          expect(stats.size).toBe(0)
        }),
      ),
    )

    it.live("writes multi-line content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "multiline.txt")
          const lines = ["Line 1", "Line 2", "Line 3", ""].join("\n")
          yield* run({ filePath: filepath, content: lines })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe(lines)
        }),
      ),
    )

    it.live("handles different line endings", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "crlf.txt")
          const content = "Line 1\r\nLine 2\r\nLine 3"
          yield* run({ filePath: filepath, content })

          const buf = yield* Effect.promise(() => fs.readFile(filepath))
          expect(buf.toString()).toBe(content)
        }),
      ),
    )
  })

  describe("error handling", () => {
    it.live("throws error when OS denies write access", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const readonlyPath = path.join(dir, "readonly.txt")
          yield* Effect.promise(() => fs.writeFile(readonlyPath, "test", "utf-8"))
          yield* Effect.promise(() => fs.chmod(readonlyPath, 0o444))
          yield* markRead(ctx.sessionID, readonlyPath)

          const exit = yield* run({ filePath: readonlyPath, content: "new content" }).pipe(Effect.exit)
          expect(exit._tag).toBe("Failure")
        }),
      ),
    )
  })

  describe("title generation", () => {
    it.live("returns relative path as title", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "src", "components", "Button.tsx")
          yield* Effect.promise(() => fs.mkdir(path.dirname(filepath), { recursive: true }))

          const result = yield* run({ filePath: filepath, content: "export const Button = () => {}" })
          expect(result.title).toEndWith(path.join("src", "components", "Button.tsx"))
        }),
      ),
    )
  })
})
