import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
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

const fail = Effect.fn("LspToolTest.fail")(function* (
  dir: string,
  args: Tool.InferParameters<typeof LspTool>,
  next: Tool.Context = ctx,
) {
  const exit = yield* run(args, next).pipe(Effect.exit)
  if (Exit.isFailure(exit)) {
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err : new Error(String(err))
  }
  throw new Error("expected lsp to fail")
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
            const result = yield* run({ operation: "documentSymbol", filePath: file }, next)
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

    it.live("workspaceSymbol has no permission request or cursor details", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const { items, next } = asks()
            const result = yield* run({ operation: "workspaceSymbol", query: "TestSymbol" }, next)
            const req = items.find((item) => item.permission === "lsp")

            expect(req).toBeUndefined()
            expect(result.title).toBe(`workspaceSymbol "TestSymbol"`)
          }),
        { git: true },
      ),
    )
  })

  describe("required parameters", () => {
    it.live("workspaceSymbol requires query", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const err = yield* fail(dir, { operation: "workspaceSymbol" }, ctx)
            expect(err.message).toContain("query is required")
          }),
        { git: true },
      ),
    )

    it.live("workspaceSymbol works with query", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const result = yield* run({ operation: "workspaceSymbol", query: "Foo" }, ctx)
            expect(result.title).toBe(`workspaceSymbol "Foo"`)
          }),
        { git: true },
      ),
    )

    const positionOps = [
      "goToDefinition",
      "findReferences",
      "hover",
      "goToImplementation",
      "prepareCallHierarchy",
      "incomingCalls",
      "outgoingCalls",
    ] as const

    for (const op of positionOps) {
      it.live(`${op} requires filePath, line, character`, () =>
        provideTmpdirInstance(
          (dir) =>
            Effect.gen(function* () {
              const file = path.join(dir, "test.ts")
              yield* put(file)

              const err1 = yield* fail(dir, { operation: op, line: 1, character: 0 }, ctx)
              expect(err1.message).toContain("filePath is required")

              const err2 = yield* fail(dir, { operation: op, filePath: file, character: 0 }, ctx)
              expect(err2.message).toContain("line and character are required")

              const err3 = yield* fail(dir, { operation: op, filePath: file, line: 1 }, ctx)
              expect(err3.message).toContain("line and character are required")

              const { items, next } = asks()
              const result = yield* run({ operation: op, filePath: file, line: 1, character: 1 }, next)
              expect(result.title).toBe(`${op} test.ts:1:1`)
              const req = items.find((item) => item.permission === "lsp")
              expect(req!.metadata).toEqual({
                operation: op,
                filePath: file,
                line: 1,
                character: 1,
              })
            }),
          { git: true },
        ),
      )
    }

    it.live("documentSymbol requires only filePath", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const file = path.join(dir, "test.ts")
            yield* put(file)

            const { items, next } = asks()
            const result = yield* run({ operation: "documentSymbol", filePath: file }, next)
            expect(result.title).toBe("documentSymbol test.ts")
            const req = items.find((item) => item.permission === "lsp")
            expect(req!.metadata).toEqual({
              operation: "documentSymbol",
              filePath: file,
            })
          }),
        { git: true },
      ),
    )

    it.live("query is ignored by non-workspaceSymbol operations", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const file = path.join(dir, "test.ts")
            yield* put(file)

            const nonPositionOps = [
              "goToDefinition",
              "findReferences",
              "hover",
              "documentSymbol",
              "goToImplementation",
              "prepareCallHierarchy",
              "incomingCalls",
              "outgoingCalls",
            ] as const
            for (const op of nonPositionOps) {
              const result = yield* run(
                {
                  operation: op,
                  filePath: file,
                  line: 1,
                  character: 1,
                  query: "shouldBeIgnored",
                } as unknown as Tool.InferParameters<typeof LspTool>,
                ctx,
              )
              expect(result).toBeDefined()
            }
          }),
        { git: true },
      ),
    )

    it.live("workspaceSymbol ignores line and character", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const { items, next } = asks()
            const result = yield* run(
              {
                operation: "workspaceSymbol",
                query: "Foo",
                filePath: "ignored.ts",
                line: 42,
                character: 99,
              } as unknown as Tool.InferParameters<typeof LspTool>,
              next,
            )
            expect(result.title).toBe(`workspaceSymbol "Foo"`)
            const req = items.find((item) => item.permission === "lsp")
            expect(req).toBeUndefined()
          }),
        { git: true },
      ),
    )

    it.live("documentSymbol ignores line and character", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const file = path.join(dir, "test.ts")
            yield* put(file)

            const { items, next } = asks()
            const result = yield* run(
              {
                operation: "documentSymbol",
                filePath: file,
                line: 42,
                character: 99,
              } as unknown as Tool.InferParameters<typeof LspTool>,
              next,
            )
            expect(result.title).toBe("documentSymbol test.ts")
            const req = items.find((item) => item.permission === "lsp")
            expect(req!.metadata).toEqual({
              operation: "documentSymbol",
              filePath: file,
            })
          }),
        { git: true },
      ),
    )
  })
})
