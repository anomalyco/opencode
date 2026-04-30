import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { GlobTool } from "../../src/tool/glob"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(CrossSpawnSpawner.defaultLayer, AppFileSystem.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
)

async function write(file: string, body: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
}

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

describe("tool.glob", () => {
  it.live("matches files from a directory path", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => write(path.join(dir, "a.ts"), "export const a = 1\n"))
        yield* Effect.promise(() => write(path.join(dir, "b.txt"), "hello\n"))
        const info = yield* GlobTool
        const glob = yield* info.init()
        const result = yield* glob.execute(
          {
            pattern: "*.ts",
            path: dir,
          },
          ctx,
        )
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain(path.join(dir, "a.ts"))
        expect(result.output).not.toContain(path.join(dir, "b.txt"))
      }),
    ),
  )
})
