import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { EditTool } from "../../src/tool/edit"
import { WriteTool } from "../../src/tool/write"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionID, MessageID } from "../../src/session/schema"
import * as Tool from "../../src/tool/tool"
import { testEffect } from "../lib/effect"
import type * as LSPClient from "@/lsp/client"

// Workspace-wide diagnostics are fed through the LSP service. The persisted
// metadata must only contain the touched file, not the whole workspace map.
const state = {
  diagnostics: {} as Record<string, LSPClient.Diagnostic[]>,
}

const fakeLSP = LayerNode.make({
  service: LSP.Service,
  layer: Layer.succeed(
    LSP.Service,
    LSP.Service.of({
      init: () => Effect.void,
      status: () => Effect.succeed([]),
      hasClients: () => Effect.succeed(true),
      touchFile: () => Effect.void,
      diagnostics: () => Effect.succeed(state.diagnostics),
      hover: () => Effect.succeed(undefined),
      definition: () => Effect.succeed([]),
      references: () => Effect.succeed([]),
      implementation: () => Effect.succeed([]),
      documentSymbol: () => Effect.succeed([]),
      workspaceSymbol: () => Effect.succeed([]),
      prepareCallHierarchy: () => Effect.succeed([]),
      incomingCalls: () => Effect.succeed([]),
      outgoingCalls: () => Effect.succeed([]),
    }),
  ),
  deps: [],
})

const layer = LayerNode.compile(
  LayerNode.group([
    fakeLSP,
    FSUtil.node,
    Format.node,
    EventV2Bridge.node,
    Truncate.node,
    Agent.node,
    CrossSpawnSpawner.node,
  ]),
)

const it = testEffect(layer)

const ctx = {
  sessionID: SessionID.make("ses_test-lsp-metadata"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
  state.diagnostics = {}
})

const writeRun = Effect.fn("LSPMetadataTest.writeRun")(function* (
  args: Tool.InferParameters<typeof WriteTool>,
  next: Tool.Context = ctx,
) {
  const info = yield* WriteTool
  const tool = yield* info.init()
  return yield* tool.execute(args, next)
})

const editRun = Effect.fn("LSPMetadataTest.editRun")(function* (
  args: Tool.InferParameters<typeof EditTool>,
  next: Tool.Context = ctx,
) {
  const info = yield* EditTool
  const tool = yield* info.init()
  return yield* tool.execute(args, next)
})

const severity = (n: number): LSPClient.Diagnostic =>
  ({
    severity: n as LSPClient.Diagnostic["severity"],
    message: `diag ${n}`,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  }) as LSPClient.Diagnostic

describe("tool diagnostics metadata", () => {
  it.instance("write persists only touched file diagnostics", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const filePath = path.join(test.directory, "a.lua")
      const normalizedFilepath = FSUtil.normalizePath(filePath)
      const otherPath = FSUtil.normalizePath(path.join(test.directory, "b.lua"))
      state.diagnostics = {
        [normalizedFilepath]: [severity(1), severity(1)],
        [otherPath]: Array.from({ length: 250 }, () => severity(1)),
      }

      const result = yield* writeRun({ filePath, content: "print('hi')" })

      expect(Object.keys(result.metadata.diagnostics)).toEqual([normalizedFilepath])
      expect(result.metadata.diagnostics[normalizedFilepath]?.length).toBe(2)
    }),
  )

  it.instance("edit persists only touched file diagnostics", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const filePath = path.join(test.directory, "a.lua")
      yield* Effect.promise(() => fs.writeFile(filePath, "hello\n", "utf-8"))
      const normalizedFilepath = FSUtil.normalizePath(filePath)
      const otherPath = FSUtil.normalizePath(path.join(test.directory, "b.lua"))
      state.diagnostics = {
        [normalizedFilepath]: [severity(1)],
        [otherPath]: Array.from({ length: 250 }, () => severity(1)),
      }

      const result = yield* editRun({ filePath, oldString: "hello", newString: "world" })

      expect(Object.keys(result.metadata.diagnostics)).toEqual([normalizedFilepath])
      expect(result.metadata.diagnostics[normalizedFilepath]?.length).toBe(1)
    }),
  )
})