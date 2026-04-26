import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { GrepTool } from "../../src/tool/grep"
import { provideInstance, provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "../../src/tool"
import { Agent } from "../../src/agent/agent"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const root = path.join(__dirname, "../..")

describe("tool.grep", () => {
  it.live("basic search", () =>
    Effect.gen(function* () {
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* provideInstance(root)(
        grep.execute(
          {
            pattern: "export",
            path: path.join(root, "src/tool"),
            include: "*.ts",
          },
          ctx,
        ),
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
      expect(result.output).toContain("Found")
    }),
  )

  it.live("no matches returns correct output", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "test.txt"), "hello world"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "xyznonexistentpatternxyz123",
            path: dir,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      }),
    ),
  )

  it.live("finds matches in tmp instance", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "test.txt"), "line1\nline2\nline3"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "line",
            path: dir,
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
      }),
    ),
  )

  it.live("supports exact file paths", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "test.txt")
        yield* Effect.promise(() => Bun.write(file, "line1\nline2\nline3"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "line2",
            path: file,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(1)
        expect(result.output).toContain(file)
        expect(result.output).toContain("Line 2: line2")
      }),
    ),
  )
})
