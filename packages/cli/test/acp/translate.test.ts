import { describe, expect, test } from "bun:test"
import { OpenCodeEvent, type OpenCodeEventEncoded } from "@opencode/protocol/groups/event"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Schema } from "effect"
import path from "node:path"
import { ACPReplay } from "../../src/acp/replay"
import { ACPTranslate } from "../../src/acp/translate"
import {
  assistantMessage,
  childCreated,
  delivered,
  durableEvent,
  ephemeralEvent,
  failed,
  reasoningDelta,
  stepEnded,
  succeeded,
  textDelta,
  toolCalled,
  toolFailed,
  toolProgress,
  toolStarted,
  toolSucceeded,
} from "./wire-fixture"

const root = Session.ID.make("ses_root")
const ctx: ACPTranslate.TurnContext = {
  sessionID: root,
  cwd: "/workspace",
  start: { type: "input", id: SessionMessage.ID.make("msg_input") },
  childUpdates: false,
  compaction: false,
}
const decodeEvent = Schema.decodeUnknownSync(OpenCodeEvent)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Info)

const live = (...events: OpenCodeEventEncoded[]) => [delivered(root, "msg_input"), ...events]
const usage = (input: number, output: number, reasoning = 0, read = 0, write = 0) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
})
const providerError = { type: "provider.error", message: "summary request failed" }
const compaction = {
  started: (sessionID: string = root) =>
    durableEvent("session.compaction.started", { sessionID, reason: "manual", recent: "", inputID: "msg_compact" }),
  delta: (text: string, sessionID: string = root) => ephemeralEvent("session.compaction.delta", { sessionID, text }),
  ended: (text: string, sessionID: string = root) =>
    durableEvent("session.compaction.ended", { sessionID, reason: "manual", text, recent: "" }),
  failed: (error: { type: string; message: string }, reason: "auto" | "manual" = "manual") =>
    durableEvent("session.compaction.failed", { sessionID: root, reason, error }),
}
const marker = (value: Record<string, unknown>) => ({
  sessionUpdate: "session_info_update",
  _meta: { "opencode/compaction": { messageId: "msg_compact", reason: "manual", ...value } },
})
const childMeta = (id: string, parentID: string, depth: number, title: string) => ({
  "opencode/child-session": { id, parentID, depth, title },
})
const compactionMessage = (input: Record<string, unknown>) => ({
  id: "msg_compaction",
  type: "compaction",
  reason: "auto",
  time: { created: 1 },
  ...input,
})

type Row = {
  readonly name: string
  readonly ctx?: Partial<ACPTranslate.TurnContext>
  readonly events?: OpenCodeEventEncoded[]
  readonly messages?: unknown[]
  readonly expected: object
}

const rows: Row[] = [
  {
    name: "ignores a session's events until its own input is delivered",
    events: [textDelta(root, "msg_early", "early"), delivered(root, "msg_other_input"), succeeded(root)],
    expected: { updates: [], terminal: undefined },
  },
  {
    name: "ignores other sessions' events",
    events: live(
      delivered("ses_other", "msg_input"),
      textDelta("ses_other", "msg_other", "other"),
      textDelta(root, "msg_ok", "accepted"),
    ),
    expected: { updates: [{ sessionUpdate: "agent_message_chunk", messageId: "msg_ok" }] },
  },
  {
    name: "streams text and reasoning with one message ID per reasoning ordinal",
    events: live(
      reasoningDelta(root, "msg_a", "think"),
      textDelta(root, "msg_a", "answer", 1),
      reasoningDelta(root, "msg_a", "more", 1),
    ),
    expected: {
      updates: [
        { sessionUpdate: "agent_thought_chunk", messageId: "msg_a:reasoning:0", content: { text: "think" } },
        { sessionUpdate: "agent_message_chunk", messageId: "msg_a", content: { text: "answer" } },
        { sessionUpdate: "agent_thought_chunk", messageId: "msg_a:reasoning:1", content: { text: "more" } },
      ],
    },
  },
  {
    name: "ends a normal turn with end_turn",
    events: live(stepEnded(root, "msg_1"), succeeded(root)),
    expected: { response: { stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } },
  },
  {
    name: "ends a length-limited step with max_tokens",
    events: live(stepEnded(root, "msg_1", { finish: "length" }), succeeded(root)),
    expected: { response: { stopReason: "max_tokens" } },
  },
  {
    name: "ends a content-filtered step with refusal",
    events: live(stepEnded(root, "msg_1", { finish: "content-filter" }), succeeded(root)),
    expected: { response: { stopReason: "refusal" } },
  },
  {
    name: "ends a content-filter failure with refusal and no error",
    events: live(failed(root, { type: "provider.content-filter", message: "blocked" })),
    expected: { response: { stopReason: "refusal" }, failure: undefined },
  },
  {
    name: "ends a server-side interruption with cancelled",
    events: live(durableEvent("session.execution.interrupted", { sessionID: root, reason: "shutdown" })),
    expected: { terminal: "interrupted", response: { stopReason: "cancelled" } },
  },
  {
    name: "ends an aborted execution with cancelled and no error",
    events: live(failed(root, { type: "aborted", message: "interrupted" })),
    expected: { response: { stopReason: "cancelled" }, failure: undefined },
  },
  {
    name: "fails an execution auth failure as auth required",
    events: live(failed(root, { type: "provider.auth", message: "missing key" })),
    expected: { failure: "ACPAuthRequiredError" },
  },
  {
    name: "fails a step auth failure as auth required even when the execution succeeds",
    events: live(
      durableEvent("session.step.failed", {
        sessionID: root,
        assistantMessageID: "msg_1",
        error: { type: "provider.auth", message: "expired" },
      }),
      succeeded(root),
    ),
    expected: { terminal: "succeeded", failure: "ACPAuthRequiredError" },
  },
  {
    name: "fails other execution failures as service failures",
    events: live(failed(root, { type: "provider.rate-limit", message: "slow down" })),
    expected: { failure: "ACPServiceFailureError" },
  },
  {
    name: "sums usage across steps and reports thought and cache tokens",
    events: live(
      stepEnded(root, "msg_1", { finish: "tool-calls", tokens: usage(100, 10, 0, 0, 50) }),
      stepEnded(root, "msg_2", { tokens: usage(20, 5, 3, 150) }),
      succeeded(root),
    ),
    expected: {
      response: {
        usage: {
          inputTokens: 120,
          outputTokens: 15,
          thoughtTokens: 3,
          cachedReadTokens: 150,
          cachedWriteTokens: 50,
          totalTokens: 338,
        },
      },
      context: usage(20, 5, 3, 150),
    },
  },
  {
    name: "counts a failed step's tokens and clears its error when the next step starts",
    events: live(
      durableEvent("session.step.failed", {
        sessionID: root,
        assistantMessageID: "msg_1",
        error: { type: "provider.stream", message: "stream interrupted" },
        cost: 0,
        tokens: usage(40, 4),
      }),
      durableEvent("session.step.started", {
        sessionID: root,
        assistantMessageID: "msg_2",
        agent: "build",
        model: { providerID: "test", id: "test-model" },
        started: 0,
      }),
      stepEnded(root, "msg_2", { tokens: usage(20, 7) }),
      succeeded(root),
    ),
    expected: {
      response: { stopReason: "end_turn", usage: { inputTokens: 60, outputTokens: 11, totalTokens: 71 } },
      failure: undefined,
      context: usage(20, 7),
    },
  },
  {
    name: "excludes child session steps from the turn usage",
    events: live(
      childCreated("ses_child", root, "Explore"),
      stepEnded("ses_child", "msg_child", { tokens: usage(500, 50) }),
      succeeded("ses_child"),
      stepEnded(root, "msg_root", { tokens: usage(20, 7) }),
      succeeded(root),
    ),
    expected: { response: { usage: { inputTokens: 20, outputTokens: 7, totalTokens: 27 } }, context: usage(20, 7) },
  },
  {
    name: "streams a tool call from pending through progress to completion",
    events: live(
      toolStarted(root, "call_ok", "shell"),
      toolCalled(root, "call_ok", { command: "printf done", workdir: "sub" }),
      toolProgress(root, "call_ok", { phase: 1 }),
      toolSucceeded(root, "call_ok", { exit: 0 }, "done"),
    ),
    expected: {
      updates: [
        { sessionUpdate: "tool_call", toolCallId: "call_ok", status: "pending", kind: "execute" },
        {
          sessionUpdate: "tool_call_update",
          status: "in_progress",
          title: "printf done",
          locations: [{ path: path.resolve("/workspace", "sub") }],
          rawInput: { command: "printf done", workdir: "sub" },
        },
        { sessionUpdate: "tool_call_update", status: "in_progress" },
        {
          sessionUpdate: "tool_call_update",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "done" } }],
          rawOutput: { metadata: { exit: 0 } },
        },
      ],
    },
  },
  {
    name: "fails a tool call with its partial content and error",
    events: live(
      toolStarted(root, "call_fail", "read"),
      toolCalled(root, "call_fail", { path: "/workspace/missing.ts" }),
      toolFailed(root, "call_fail", {
        error: { type: "tool.error", message: "not found" },
        metadata: { bytes: 0 },
        content: [{ type: "text", text: "opening" }],
      }),
    ),
    expected: {
      updates: [
        { status: "pending" },
        { status: "in_progress" },
        {
          status: "failed",
          kind: "read",
          locations: [{ path: "/workspace/missing.ts" }],
          content: [
            { type: "content", content: { type: "text", text: "opening" } },
            { type: "content", content: { type: "text", text: "not found" } },
          ],
          rawOutput: { metadata: { bytes: 0 }, error: "not found" },
        },
      ],
    },
  },
  {
    name: "locates the file of an edit tool",
    events: live(
      toolStarted(root, "call_edit", "edit"),
      toolCalled(root, "call_edit", { path: "/workspace/a.ts", oldString: "a", newString: "b" }),
      toolSucceeded(root, "call_edit", {}, "edited"),
    ),
    expected: {
      updates: [{}, { locations: [{ path: "/workspace/a.ts" }] }, { locations: [{ path: "/workspace/a.ts" }] }],
    },
  },
  {
    name: "locates the file of a write tool",
    events: live(
      toolStarted(root, "call_write", "write"),
      toolCalled(root, "call_write", { path: "/workspace/b.ts", content: "b" }),
      toolSucceeded(root, "call_write", {}, "written"),
    ),
    expected: {
      updates: [{}, { locations: [{ path: "/workspace/b.ts" }] }, { locations: [{ path: "/workspace/b.ts" }] }],
    },
  },
  {
    name: "locates the files of a patch tool",
    events: live(
      toolStarted(root, "call_patch", "patch"),
      toolCalled(root, "call_patch", {
        patchText: "*** Begin Patch\n*** Update File: /workspace/c.ts\n@@\n-one\n+two\n*** End Patch",
      }),
      toolSucceeded(root, "call_patch", {}, "patched"),
    ),
    expected: {
      updates: [{}, { locations: [{ path: "/workspace/c.ts" }] }, { locations: [{ path: "/workspace/c.ts" }] }],
    },
  },
  {
    name: "projects a child's tool call onto the parent with its ID and title prefixed",
    events: live(childCreated("ses_child", root, "Explore"), toolStarted("ses_child", "call_1", "read")),
    expected: {
      updates: [
        {
          sessionUpdate: "tool_call",
          toolCallId: "ses_child:call_1",
          title: "Explore: read",
          _meta: childMeta("ses_child", root, 1, "Explore"),
        },
      ],
      children: [],
    },
  },
  {
    name: "projects a nested child with its depth and its own parent, and ignores unrelated sessions",
    events: live(
      childCreated("ses_child", root, "Explore"),
      childCreated("ses_grandchild", "ses_child", "Deeper"),
      childCreated("ses_stranger", "ses_unknown", "Unrelated"),
      toolStarted("ses_grandchild", "call_1", "read"),
      textDelta("ses_stranger", "msg_stranger", "ignored"),
    ),
    expected: {
      updates: [
        {
          toolCallId: "ses_grandchild:call_1",
          title: "Deeper: read",
          _meta: childMeta("ses_grandchild", "ses_child", 2, "Deeper"),
        },
      ],
    },
  },
  {
    name: "routes child work to the extension when the client supports it",
    ctx: { childUpdates: true },
    events: live(
      childCreated("ses_child", root, "Explore"),
      durableEvent("session.execution.started", { sessionID: "ses_child" }),
      textDelta("ses_child", "msg_child", "nested"),
      failed("ses_child", { type: "tool.error", message: "boom" }),
    ),
    expected: {
      updates: [],
      terminal: undefined,
      children: [
        { childSessionId: "ses_child", parentSessionId: root, depth: 1, type: "status", status: "created" },
        { childSessionId: "ses_child", type: "status", status: "running" },
        { childSessionId: "ses_child", type: "update", update: { sessionUpdate: "agent_message_chunk" } },
        { childSessionId: "ses_child", type: "status", status: "failed", error: { type: "tool.error" } },
      ],
    },
  },
  {
    name: "fails the tools a cancelled turn left open, including a child's",
    events: live(
      childCreated("ses_child", root, "Explore"),
      toolStarted(root, "call_root", "shell"),
      toolCalled(root, "call_root", { command: "sleep 60" }),
      toolProgress(root, "call_root", { pid: 1 }),
      toolStarted("ses_child", "call_child", "read"),
    ),
    expected: {
      abandoned: [
        {
          toolCallId: "call_root",
          status: "failed",
          rawInput: { command: "sleep 60" },
          rawOutput: { metadata: { pid: 1 }, error: "Cancelled" },
        },
        { toolCallId: "ses_child:call_child", status: "failed", title: "Explore: read" },
      ],
    },
  },
  {
    name: "cancels the compaction a cancelled turn left open",
    ctx: { compaction: true },
    events: live(compaction.started()),
    expected: {
      abandoned: [{ sessionUpdate: "compaction_update", compactionId: "msg_compact", status: "cancelled" }],
    },
  },
  {
    name: "streams a compaction's summary and completes it with the full summary",
    ctx: { compaction: true },
    events: live(compaction.started(), compaction.delta("Sum"), compaction.delta("mary"), compaction.ended("Summary")),
    expected: {
      updates: [
        { sessionUpdate: "compaction_update", compactionId: "msg_compact", status: "in_progress" },
        { sessionUpdate: "compaction_summary_chunk", compactionId: "msg_compact", content: { text: "Sum" } },
        { sessionUpdate: "compaction_summary_chunk", compactionId: "msg_compact", content: { text: "mary" } },
        { status: "completed", summary: [{ type: "text", text: "Summary" }] },
      ],
    },
  },
  {
    name: "clears the summary of a compaction that completes without a readable one",
    ctx: { compaction: true },
    events: live(compaction.started(), compaction.ended("")),
    expected: { updates: [{ status: "in_progress" }, { status: "completed", summary: null }] },
  },
  {
    name: "fails a compaction with its error and clears the partial summary",
    ctx: { compaction: true },
    events: live(compaction.started(), compaction.delta("partial"), compaction.failed(providerError)),
    expected: {
      updates: [
        { status: "in_progress" },
        { sessionUpdate: "compaction_summary_chunk" },
        { status: "failed", summary: null, error: "summary request failed" },
      ],
    },
  },
  {
    name: "keeps core's own compaction failure messages",
    ctx: { compaction: true },
    events: live(compaction.started(), compaction.failed({ type: "compaction.failed", message: "Output limit" })),
    expected: { updates: [{ status: "in_progress" }, { status: "failed", error: "Output limit" }] },
  },
  {
    name: "reports a compaction defect as a generic failure",
    ctx: { compaction: true },
    events: live(
      compaction.started(),
      compaction.failed({ type: "compaction.failed", message: "Error: locked\n    at run (compaction.ts:1:1)" }),
    ),
    expected: { updates: [{ status: "in_progress" }, { status: "failed", error: "Compaction failed" }] },
  },
  {
    name: "reports an interrupted compaction as cancelled",
    ctx: { compaction: true },
    events: live(compaction.started(), compaction.failed({ type: "compaction.interrupted", message: "interrupted" })),
    expected: { updates: [{ status: "in_progress" }, { status: "cancelled", summary: null }] },
  },
  {
    name: "reports an aborted compaction as cancelled",
    ctx: { compaction: true },
    events: live(compaction.started(), compaction.failed({ type: "aborted", message: "Compaction cancelled" })),
    expected: { updates: [{ status: "in_progress" }, { status: "cancelled", summary: null }] },
  },
  {
    name: "opens a compaction that fails before it starts before settling it",
    ctx: { compaction: true },
    events: live(compaction.failed({ type: "compaction.unavailable", message: "Nothing to compact yet" }, "auto")),
    expected: {
      updates: [
        { compactionId: "msg_2", status: "in_progress" },
        { compactionId: "msg_2", status: "failed", error: "Nothing to compact yet" },
      ],
    },
  },
  {
    name: "drops summary chunks outside an open compaction",
    ctx: { compaction: true },
    events: live(
      compaction.delta("early"),
      compaction.started(),
      compaction.ended("Summary"),
      compaction.delta("late"),
    ),
    expected: { updates: [{ status: "in_progress" }, { status: "completed" }] },
  },
  {
    name: "drops a compaction end without a start",
    ctx: { compaction: true },
    events: live(compaction.ended("Summary")),
    expected: { updates: [] },
  },
  {
    name: "marks a compaction without forwarding its summary when the client lacks the capability",
    events: live(compaction.started(), compaction.delta("Summary"), compaction.ended("Summary")),
    expected: { updates: [marker({ status: "started" }), marker({ status: "completed" })] },
  },
  {
    name: "marks a failed compaction with the full error",
    events: live(compaction.started(), compaction.failed(providerError)),
    expected: { updates: [marker({ status: "started" }), marker({ status: "failed", error: providerError })] },
  },
  {
    name: "marks a compaction that fails before it starts without opening it",
    events: live(compaction.failed(providerError, "auto")),
    expected: {
      updates: [
        {
          _meta: {
            "opencode/compaction": { status: "failed", messageId: "msg_2", reason: "auto", error: providerError },
          },
        },
      ],
    },
  },
  {
    name: "keeps a child's compaction projected onto the parent as a marker",
    ctx: { compaction: true },
    events: live(
      childCreated("ses_child", root, "Explore"),
      compaction.started("ses_child"),
      compaction.ended("Summary", "ses_child"),
    ),
    expected: {
      updates: [
        { _meta: { "opencode/compaction": { status: "started" }, ...childMeta("ses_child", root, 1, "Explore") } },
        { _meta: { "opencode/compaction": { status: "completed" }, ...childMeta("ses_child", root, 1, "Explore") } },
      ],
    },
  },
  {
    name: "sends a child's compaction as standard updates through the extension",
    ctx: { compaction: true, childUpdates: true },
    events: live(
      childCreated("ses_child", root, "Explore"),
      compaction.started("ses_child"),
      compaction.ended("Summary", "ses_child"),
    ),
    expected: {
      updates: [],
      children: [
        { status: "created" },
        { type: "update", update: { sessionUpdate: "compaction_update", status: "in_progress" } },
        { type: "update", update: { sessionUpdate: "compaction_update", status: "completed" } },
      ],
    },
  },
  {
    name: "replays a completed compaction as one terminal update",
    ctx: { compaction: true },
    messages: [compactionMessage({ status: "completed", summary: "Summary", recent: "" })],
    expected: {
      updates: [{ compactionId: "msg_compaction", status: "completed", summary: [{ type: "text", text: "Summary" }] }],
    },
  },
  {
    name: "replays a compaction without a summary as cleared",
    ctx: { compaction: true },
    messages: [compactionMessage({ status: "completed", summary: "", recent: "" })],
    expected: { updates: [{ status: "completed", summary: null }] },
  },
  {
    name: "replays a failed compaction with its error",
    ctx: { compaction: true },
    messages: [compactionMessage({ status: "failed", error: providerError })],
    expected: { updates: [{ status: "failed", summary: null, error: "summary request failed" }] },
  },
  {
    name: "replays a cancelled compaction as cancelled",
    ctx: { compaction: true },
    messages: [compactionMessage({ status: "failed", error: { type: "aborted", message: "Compaction cancelled" } })],
    expected: { updates: [{ status: "cancelled", summary: null }] },
  },
  {
    name: "skips a running compaction on replay",
    ctx: { compaction: true },
    messages: [compactionMessage({ status: "running", summary: "", recent: "" })],
    expected: { updates: [] },
  },
  {
    name: "replays a compaction as a marker when the client lacks the capability",
    messages: [compactionMessage({ status: "completed", summary: "Summary", recent: "" })],
    expected: {
      updates: [
        {
          sessionUpdate: "session_info_update",
          _meta: { "opencode/compaction": { status: "completed", messageId: "msg_compaction", reason: "auto" } },
        },
      ],
    },
  },
  {
    name: "replays reasoning with the same message IDs as live reasoning ordinals",
    messages: [
      assistantMessage("msg_a", {
        content: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "answer" },
          { type: "reasoning", text: "more" },
        ],
      }),
    ],
    expected: {
      updates: [
        { sessionUpdate: "agent_thought_chunk", messageId: "msg_a:reasoning:0" },
        { sessionUpdate: "agent_message_chunk", messageId: "msg_a" },
        { sessionUpdate: "agent_thought_chunk", messageId: "msg_a:reasoning:1" },
      ],
    },
  },
]

describe("acp turn translation", () => {
  test.each(rows)("$name", (row) => {
    expect(translate(row)).toMatchObject(row.expected)
  })
})

function translate(row: Row) {
  const context = { ...ctx, ...row.ctx }
  if (row.messages) {
    const capabilities = {
      childSessionUpdates: context.childUpdates,
      formElicitation: false,
      compaction: context.compaction,
    }
    return {
      updates: row.messages.flatMap((message) => [
        ...ACPReplay.updates(decodeMessage(message), context.cwd, capabilities),
      ]),
    }
  }
  const result = run(row.events ?? [], context)
  return {
    updates: updates(result.outputs),
    children: result.outputs.flatMap((output) => (output._tag === "ChildUpdate" ? [output.update] : [])),
    terminal: result.terminal,
    response: result.terminal ? ACPTranslate.response(result.state, root, result.terminal) : undefined,
    failure: ACPTranslate.failure(result.state)?._tag,
    context: result.state.usage?.last,
    abandoned: updates(ACPTranslate.abandon(result.state, context).outputs),
  }
}

function run(events: ReadonlyArray<OpenCodeEventEncoded>, context = ctx) {
  return events.reduce<{
    state: ACPTranslate.TurnState
    outputs: ACPTranslate.Output[]
    terminal?: ACPTranslate.Terminal
  }>(
    (acc, event, index) => {
      const next = ACPTranslate.fold(acc.state, decodeEvent({ ...event, id: `evt_${index + 1}` }), context)
      return {
        state: next.state,
        outputs: [...acc.outputs, ...next.outputs],
        ...(next.terminal ? { terminal: next.terminal } : {}),
      }
    },
    { state: ACPTranslate.initial, outputs: [] },
  )
}

function updates(outputs: ReadonlyArray<ACPTranslate.Output>) {
  return outputs.flatMap((output) => (output._tag === "SessionUpdate" ? [output.update] : []))
}
