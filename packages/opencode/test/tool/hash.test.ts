import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { HashTool } from "../../src/tool/hash"
import { Truncate } from "@/tool/truncate"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(CrossSpawnSpawner.defaultLayer, AppFileSystem.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
)

const baseCtx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.hash", () => {
  it.live("computes sha256 by default", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "hello.txt")
        yield* Effect.promise(() => Bun.write(file, "hello"))

        const toolInfo = yield* HashTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute({ filePath: file }, baseCtx)

        expect(result.metadata.algorithm).toBe("sha256")
        expect(result.metadata.digest).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
        expect(result.output).toContain("sha256 digest")
      }),
    ),
  )

  it.live("verifies an expected digest", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "hello.txt")
        yield* Effect.promise(() => Bun.write(file, "hello"))

        const toolInfo = yield* HashTool
        const tool = yield* toolInfo.init()
        const result = yield* tool.execute(
          {
            filePath: file,
            expected: "2cf2 4dba 5fb0 a30e 26e8 3b2a c5b9 e29e 1b16 1e5c 1fa7 425e 7304 3362 938b 9824",
          },
          baseCtx,
        )

        expect(result.metadata.matches).toBe(true)
        expect(result.title).toContain("verified")
        expect(result.output).toContain("verified")
      }),
    ),
  )
})
