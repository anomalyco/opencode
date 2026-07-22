import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient, ToolPart } from "@opencode-ai/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"
import { EditTool } from "../../src/tool/edit"
import { ReviewFs } from "@/effect/review-fs-layer"
import { Format } from "../../src/format"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { LSP } from "@/lsp/lsp"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { TestInstance, disposeAllInstances } from "../fixture/fixture"
import { forceEnableForAcp, reset, setClientWriteTextFileSupported } from "@/acp/review-mode"
import { flushPendingWrites } from "@/acp/review-staging"
import { ACPEvent } from "@/acp/event"
import { ACPSession } from "@/acp/session"

const SESSION_ID = "ses_review_order"

const baseCtx = {
  sessionID: SessionID.make(SESSION_ID),
  messageID: MessageID.make("msg_review_order"),
  callID: "call_edit",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const layer = LayerNode.compile(
  LayerNode.group([LSP.node, ReviewFs.node, Format.node, EventV2Bridge.node, Truncate.node, Agent.node]),
)

const it = testEffect(layer)

function makeSessionService() {
  return ManagedRuntime.make(LayerNode.compile(ACPSession.node)).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

// Records every outbound ACP call in the exact order it happened so we can
// assert the client-facing protocol sequence, not just the end state.
type TimelineEntry =
  | { readonly kind: "notify"; readonly status: string; readonly toolCallId: string }
  | { readonly kind: "write"; readonly sessionId: string; readonly path: string; readonly content: string }

function makeRecordingConnection() {
  const timeline: TimelineEntry[] = []
  const connection = {
    sessionUpdate: async (params: Parameters<AgentSideConnection["sessionUpdate"]>[0]) => {
      const update = params.update
      if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
        timeline.push({ kind: "notify", status: update.status, toolCallId: update.toolCallId })
      }
    },
    writeTextFile: async (input: { sessionId: string; path: string; content: string }) => {
      timeline.push({ kind: "write", sessionId: input.sessionId, path: input.path, content: input.content })
      return {}
    },
  } satisfies Pick<AgentSideConnection, "sessionUpdate" | "writeTextFile">
  return { connection, timeline }
}

const readDisk = (filepath: string) => Effect.promise(() => fs.readFile(filepath, "utf-8").catch(() => ""))

describe("ACP review order", () => {
  afterEach(async () => {
    delete process.env.OPENCODE_ACP_REVIEW
    delete process.env.OPENCODE_CLIENT
    reset()
    await disposeAllInstances()
  })

  it.instance("sends the diff notification before the write, sends exactly one write, and never touches disk itself", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_CLIENT = "acp"
      forceEnableForAcp()
      setClientWriteTextFileSupported(true)
      ReviewOverlay.setActiveSession(SESSION_ID)

      const test = yield* TestInstance
      const edit = yield* EditTool
      const tool = yield* edit.init()
      const filepath = path.join(test.directory, "order.txt")
      yield* Effect.promise(() => fs.writeFile(filepath, "before\n", "utf-8"))

      // 1. Run the real edit tool. This is opencode's own "self-edit" path -
      // it must stage the change in memory and never touch the real file.
      yield* tool.execute({ filePath: filepath, oldString: "before", newString: "after" }, baseCtx)
      expect(yield* readDisk(filepath)).toBe("before\n")

      // 2. Feed the resulting tool-completion event through the same ACP
      // event pipeline the live agent uses, and record the exact order of
      // outbound protocol calls (tool_call_update notification vs write).
      const { connection, timeline } = makeRecordingConnection()
      const session = makeSessionService()
      const sdk = {} as unknown as OpencodeClient
      const subscription = new ACPEvent.Subscription({ sdk, connection, session })

      yield* session.create({ id: SESSION_ID, cwd: test.directory })

      const completedPart = {
        id: "part_edit",
        sessionID: SESSION_ID,
        messageID: "msg_edit",
        type: "tool",
        callID: "call_edit",
        tool: "edit",
        state: {
          status: "completed",
          input: { filePath: filepath, oldString: "before", newString: "after" },
          output: "edited",
          title: "edit",
          metadata: {},
          time: { start: Date.now() - 1, end: Date.now() },
        },
      } satisfies ToolPart

      const completedEvent = {
        id: "evt_edit_completed",
        type: "message.part.updated",
        properties: {
          sessionID: SESSION_ID,
          time: Date.now(),
          part: completedPart,
        },
      } satisfies Event

      yield* Effect.promise(() => subscription.handle(completedEvent))

      // Exactly one write, and it lands after the completed notification -
      // matching the observed live ACP trace (tool_call_update, then
      // fs/write_text_file).
      const writes = timeline.filter((entry): entry is Extract<TimelineEntry, { kind: "write" }> =>
        entry.kind === "write",
      )
      expect(writes).toHaveLength(1)
      expect(writes[0]?.content).toBe("after\n")
      expect(writes[0]?.path).toContain("order.txt")

      const completedNotifyIndex = timeline.findIndex(
        (entry) => entry.kind === "notify" && entry.status === "completed",
      )
      const writeIndex = timeline.findIndex((entry) => entry.kind === "write")
      expect(completedNotifyIndex).toBeGreaterThanOrEqual(0)
      expect(writeIndex).toBeGreaterThan(completedNotifyIndex)

      // 3. Regression check for the double-flush bug: opencode also flushes
      // once more at end-of-turn (service.ts's prompt() handler). That must
      // be a no-op here since nothing changed since the first flush.
      yield* Effect.promise(() => flushPendingWrites(connection, SESSION_ID))
      expect(timeline.filter((entry) => entry.kind === "write")).toHaveLength(1)

      // 4. The real file on disk must still be untouched by opencode itself -
      // only the (mocked) client ever "received" the write.
      expect(yield* readDisk(filepath)).toBe("before\n")

      subscription.stop()
    }),
  )
})
