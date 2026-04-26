import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "../../src/lsp"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool, Truncate } from "../../src/tool"
import { LspTool } from "../../src/tool/lsp"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

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

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(true),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed([]),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Truncate.defaultLayer,
    lsp,
  ),
)

const init = Effect.fn("LspToolTest.init")(function* () {
  const info = yield* LspTool
  return yield* info.init()
})

const run = Effect.fn("LspToolTest.run")(function* (
  args: Tool.InferParameters<typeof LspTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

const put = Effect.fn("LspToolTest.put")(function* (file: string) {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(file, "export const x = 1\n")
})

const asks = () => {
  const items: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  return {
    items,
    next: {
      ...ctx,
      ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
        Effect.sync(() => {
          items.push(req)
        }),
    },
  }
}

describe("tool.lsp", () => {
  describe("permission metadata", () => {
    it.live("keeps cursor details for position-based operations", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const file = path.join(dir, "test.ts")
            yield* put(file)

            const { items, next } = asks()
            const result = yield* run({ operation: "goToDefinition", filePath: file, line: 3, character: 7 }, next)
            const req = items.find((item) => item.permission === "lsp")

            expect(req).toBeDefined()
            expect(req!.metadata).toEqual({
              operation: "goToDefinition",
              filePath: file,
              line: 3,
              character: 7,
            })
            expect(result.title).toBe("goToDefinition test.ts:3:7")
          }),
        { git: true },
      ),
    )

    it.live("omits cursor details for documentSymbol", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const file = path.join(dir, "test.ts")
            yield* put(file)

            const { items, next } = asks()
            const result = yield* run({ operation: "documentSymbol", filePath: file, line: 3, character: 7 }, next)
            const req = items.find((item) => item.permission === "lsp")

            expect(req).toBeDefined()
            expect(req!.metadata).toEqual({
              operation: "documentSymbol",
              filePath: file,
            })
            expect(result.title).toBe("documentSymbol test.ts")
          }),
        { git: true },
      ),
    )

    it.live("omits file and cursor details for workspaceSymbol", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const file = path.join(dir, "test.ts")
            yield* put(file)

            const { items, next } = asks()
            const result = yield* run({ operation: "workspaceSymbol", filePath: file, line: 3, character: 7 }, next)
            const req = items.find((item) => item.permission === "lsp")

            expect(req).toBeDefined()
            expect(req!.metadata).toEqual({
              operation: "workspaceSymbol",
            })
            expect(result.title).toBe("workspaceSymbol")
          }),
        { git: true },
      ),
    )
  })
})
