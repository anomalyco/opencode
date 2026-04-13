import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { GrepTool } from "../../src/tool/grep"
import { provideInstance, provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Truncate } from "../../src/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "../../src/filesystem"
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

const projectRoot = path.join(__dirname, "../..")

describe("tool.grep", () => {
  it.live("basic search", () =>
    Effect.gen(function* () {
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* provideInstance(projectRoot)(
        grep.execute(
          {
            pattern: "export",
            path: path.join(projectRoot, "src/tool"),
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
})
