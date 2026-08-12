import { describe, expect, it } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"

import { MessageV2 } from "../../src/session/message-v2"
// The Anvil (Phase 4) exercises the REAL B3b wire normalizer + the C2
// last-resort discard pass — not copies that could drift from production. Both are
// module-local helpers in prompt.ts that run on the wire right before streamText;
// they were exported for testability. C2 discards ONLY a contentless (empty)
// assistant that sits adjacent to the next — it never drops real content.
import { normalizeToolResultsFromAssistants, dropContentlessAdjacentAssistant, hasPendingUserContinuation } from "../../src/session/prompt"

import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Provider } from "@/provider/provider"

// Regression test for the threaded-continuation shape produced by
// MessageV2.toModelMessages in the openai-compatible path.
//
// When a reused assistant turn re-presents a previously-executed tool result,
// setting providerExecuted: true keeps it as ONE assistant message (text +
// paired tool-call + tool-result) — the safe shape. WITHOUT providerExecuted,
// the SDK splits it into an assistant message (tool-call) followed by a
// role:"tool" message (result), which is the consecutive-assistant / dangling
// tool shape that triggers the provider 400.
//
// This is the critical assumption underlying Phase 1 (threaded continuation):
// the structural filter must preserve the tool result AND set providerExecuted
// so the SDK renders it as an echo/reference rather than re-dispatching.

const sessionID = SessionID.make("ses_provider-executed")
const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test-model")

const model: Provider.Model = {
  id: modelID,
  providerID,
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 100000, input: 0, output: 32000 },
  status: "active" as const,
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function assistantMessageWithTool(metadata: Record<string, unknown>): SessionV1.WithParts {
  const assistant: SessionV1.Assistant = {
    id: MessageID.make("msg_1"),
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID: MessageID.make("msg_0"),
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as SessionV1.Assistant

  return {
    info: assistant,
    parts: [
      {
        type: "text",
        text: "Let me check that for you.",
        id: PartID.make("prt_text"),
        messageID: assistant.id,
        sessionID,
      } as SessionV1.Part,
      {
        id: PartID.make("prt_tool"),
        messageID: assistant.id,
        sessionID,
        type: "tool",
        tool: "read_file",
        callID: "call_1",
        state: {
          status: "completed",
          input: { path: "/tmp/test.txt" },
          output: "file contents here",
          title: "Read file",
          metadata: {},
          time: { start: 0, end: 1 },
        },
        metadata,
      } as unknown as SessionV1.Part,
    ],
  }
}

describe("threaded provider-executed tool handling in toModelMessages", () => {
  it("renders a single assistant message with text + paired providerExecuted tool call + result", async () => {
    const result = await MessageV2.toModelMessages([assistantMessageWithTool({ providerExecuted: true })], model)

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe("assistant")

    const content = result[0].content as Array<{ type: string; providerExecuted?: boolean } & Record<string, unknown>>

    const textParts = content.filter((p) => p.type === "text")
    const toolCalls = content.filter((p) => p.type === "tool-call")
    const toolResults = content.filter((p) => p.type === "tool-result")

    // carried-forward text and the paired tool call + result all in ONE message
    expect(textParts.length).toBe(1)
    expect(toolCalls.length).toBe(1)
    expect(toolResults.length).toBe(1)

    // providerExecuted is preserved so the SDK renders it as an echo, not a re-dispatch
    expect(toolCalls[0].providerExecuted).toBe(true)
  })

  it("splits into assistant + tool messages WITHOUT providerExecuted (the bad shape)", async () => {
    // Baseline documenting the exact hazard providerExecuted guards against:
    // without the flag, the SDK emits TWO messages — an assistant carrying the
    // tool-call, then a role:"tool" message carrying the result. This is the
    // consecutive-assistant / dangling-tool shape that triggers the provider 400.
    const result = await MessageV2.toModelMessages([assistantMessageWithTool({})], model)

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe("assistant")
    expect(result[1].role).toBe("tool")

    const callContent = result[0].content as Array<{ type: string }>
    expect(callContent.some((p) => p.type === "tool-call")).toBe(true)
  })
})

function assistantMessageWithNullTool(): SessionV1.WithParts {
  // A tool that ran and truthfully produced NO output (e.g. a binary with no
  // stdout/stderr). This is the disputed crux: does toModelMessages still emit a
  // paired tool-result (safe), or a bare tool-call assistant with no result
  // (dangling → consecutive-assistant provider 400 on the next wire build)?
  const assistant: SessionV1.Assistant = {
    id: MessageID.make("msg_null_1"),
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID: MessageID.make("msg_0"),
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as SessionV1.Assistant

  return {
    info: assistant,
    parts: [
      {
        id: PartID.make("prt_null_tool"),
        messageID: assistant.id,
        sessionID,
        type: "tool",
        tool: "bash",
        callID: "call_null_1",
        state: {
          status: "completed" as const,
          input: { command: "true" },
          // truthfully null output — the tool ran, produced nothing
          output: null,
          title: "Bash",
          metadata: {},
          time: { start: 0, end: 1 },
        },
        metadata: {},
      } as unknown as SessionV1.Part,
    ],
  }
}

describe("truthfully-null tool output in toModelMessages", () => {
  it("must NOT render a null-output tool as a bare assistant with a dangling tool-call", async () => {
    // Reproduces the crux hypothesis from the field 400 (ses_03d08cdceffeSLwHHrpBESzLga):
    // a completed tool whose output is truthfully null/empty can leave a bare
    // assistant carrying only a tool-call with no paired tool-result. That bare
    // assistant sits adjacent to the next assistant in the wire, which the
    // provider rejects with "Cannot have 2 or more assistant messages at the end
    // of the list."
    const result = await MessageV2.toModelMessages([assistantMessageWithNullTool()], model)

    // Rendering must produce a COMPLETED turn: an assistant with the tool-call
    // that is (at minimum) followed by a role:"tool" result — never a lone
    // assistant. A single assistant message that carries BOTH the tool-call and
    // its (null) result is also acceptable — what is NOT acceptable is an
    // assistant with a dangling tool-call and nothing after it.
    expect(Array.isArray(result)).toBe(true)

    // Assert we never end with a bare assistant whose tool-call has no result
    for (let i = 0; i < result.length; i++) {
      const msg = result[i] as { role: string; content?: unknown }
      if (msg.role !== "assistant") continue
      const content = Array.isArray(msg.content) ? (msg.content as Array<{ type?: string }>) : []
      const hasToolCall = content.some((p) => p.type === "tool-call")
      if (!hasToolCall) continue
      // a tool-call assistant must be immediately followed by a role:"tool" result
      // (or be the single self-contained message carrying its own tool-result)
      const next = result[i + 1] as { role?: string } | undefined
      const selfContained = content.some((p) => p.type === "tool-result")
      // logging the concrete shape lets us confirm exactly which branch is hit
      console.log(
        `[null-tool] assistant@${i} toolCall=${hasToolCall} selfContained=${selfContained} nextRole=${next?.role} total=${result.length}`,
      )
      expect(selfContained || next?.role === "tool").toBe(true)
    }
    // regardless of branch, there must be NO two adjacent assistants in the wire
    for (let i = 1; i < result.length; i++) {
      const a = result[i - 1] as { role?: string }
      const b = result[i] as { role?: string }
      expect(!(a.role === "assistant" && b.role === "assistant")).toBe(true)
    }
  })
})

// ─── Phase 4: The Anvil — deterministic render-boundary test for Tree 2
// (CONTINUATION-set) `length`-adjacency. ──────────────────────────────────────
//
// The recurring field failure (ses_03d08cdceffeSLwHHrpBESzLga, ses_03c2b940effe
// gMyp7s1Z1s4EXs) is a `finish=length` assistant left "open" (schema-legal:
// time.completed is Optional) and re-used, landing adjacent to another assistant
// on the wire when the intervening user renders nothing. THIS is the C2 gap — the
// one CONTINUATION state with no wire-format guarantee. This test forges a
// permanent guard by asserting the invariant through the REAL renderer
// (MessageV2.toModelMessages) + the REAL B3b splitter.

function lengthAssistantWithTool(id: string, parentID: string, text: string): SessionV1.WithParts {
  const assistant: SessionV1.Assistant = {
    id: MessageID.make(id),
    sessionID,
    role: "assistant",
    time: { created: 0 }, // NOT completed — left open, as a length-truncated turn is
    parentID: MessageID.make(parentID),
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "length", // truncated — the open-state that the gates do NOT finalize
  } as unknown as SessionV1.Assistant

  return {
    info: assistant,
    parts: [
      {
        id: PartID.make(`prt_${id}_text`),
        messageID: assistant.id,
        sessionID,
        type: "text",
        text,
      } as SessionV1.Part,
      {
        id: PartID.make(`prt_${id}_tool`),
        messageID: assistant.id,
        sessionID,
        type: "tool",
        tool: "bash",
        callID: `${id}_call`,
        state: {
          status: "completed" as const,
          input: { command: "true" },
          output: "ok",
          title: "Bash",
          metadata: {},
          time: { start: 0, end: 1 },
        },
        metadata: {},
      } as unknown as SessionV1.Part,
    ],
  }
}

function lengthAssistantPartialText(id: string, parentID: string, text: string): SessionV1.WithParts {
  // A `finish=length` assistant carrying ONLY partial text/reasoning — NO tool
  // part. This is the exact shape the sharpened blart reported at the field
  // failure (ses_03c2b940effegMyp7s1Z1s4EXs): leadingHasToolCall=false. Because
  // there is no tool-result for B3b to hoist, a plain partial-text assistant
  // cannot be split into `assistant(tool-call) + tool` — so if two of them land
  // adjacent (with the intervening user dropped), they render as consecutive
  // assistant wire messages. This is the genuine C2 gap variant.
  const assistant: SessionV1.Assistant = {
    id: MessageID.make(id),
    sessionID,
    role: "assistant",
    time: { created: 0 }, // NOT completed — left open, as a length-truncated turn is
    parentID: MessageID.make(parentID),
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "length", // truncated — the open-state that the gates do NOT finalize
  } as unknown as SessionV1.Assistant

  return {
    info: assistant,
    parts: [
      {
        id: PartID.make(`prt_${id}_text`),
        messageID: assistant.id,
        sessionID,
        type: "text",
        text,
      } as SessionV1.Part,
    ],
  }
}

function emptyUserMessage(id: string): SessionV1.WithParts {
  // A user message whose parts filter to nothing at render time — the missing
  // separator in the field failures.
  const user: SessionV1.User = {
    id: MessageID.make(id),
    sessionID,
    role: "user",
    time: { created: 0 },
    parentID: MessageID.make("msg_root"),
    modelID: model.api.id,
    providerID: model.providerID,
  } as unknown as SessionV1.User
  return {
    info: user,
    parts: [
      {
        id: PartID.make(`prt_${id}_emptytext`),
        messageID: user.id,
        sessionID,
        type: "text",
        text: "", // empty text is filtered out of the user wire message → dropped separator
        ignored: undefined,
      } as SessionV1.Part,
    ],
  }
}

function userMessage(id: string): SessionV1.WithParts {
  // A normal renderable user message.
  const user: SessionV1.User = {
    id: MessageID.make(id),
    sessionID,
    role: "user",
    time: { created: 0 },
    parentID: MessageID.make("msg_root"),
    modelID: model.api.id,
    providerID: model.providerID,
  } as unknown as SessionV1.User
  return {
    info: user,
    parts: [
      {
        id: PartID.make(`prt_${id}_text`),
        messageID: user.id,
        sessionID,
        type: "text",
        text: "question",
      } as SessionV1.Part,
    ],
  }
}

function stopAssistant(id: string, parentID: string, text = "answer"): SessionV1.WithParts {
  // A conclusively-finished (finish="stop") assistant that directly answers the
  // user with id `parentID`. This is exactly the shape a clean compaction leaves
  // behind (compaction-user + summary(stop)).
  const assistant: SessionV1.Assistant = {
    id: MessageID.make(id),
    sessionID,
    role: "assistant",
    time: { created: 0, end: 1 },
    parentID: MessageID.make(parentID),
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
  } as unknown as SessionV1.Assistant

  return {
    info: assistant,
    parts: [
      {
        id: PartID.make(`prt_${id}_text`),
        messageID: assistant.id,
        sessionID,
        type: "text",
        text,
      } as SessionV1.Part,
    ],
  }
}

describe("Phase 4 Anvil: finish=length continuation never yields consecutive assistants on the wire", () => {
  it("C2 boundary: a CONTENTLESS leading assistant + dropped-empty user + assistant is discarded (no content lost)", async () => {
    // C2 is a bounded LAST-RESORT discard — it drops ONLY a provably-contentless
    // assistant (empty/truncated, no tool-call, no text) that sits adjacent to the
    // next assistant. That empty assistant represents a dropped user separator /
    // empty truncated turn. It must NEVER drop real content and NEVER merge.
    const msgs: SessionV1.WithParts[] = [
      lengthAssistantPartialText("msg_len_1", "msg_u1", ""), // <-- contentless (empty text)
      emptyUserMessage("msg_u2"),
      lengthAssistantPartialText("msg_len_2", "msg_u2", "real next answer"),
    ]

    const wire = dropContentlessAdjacentAssistant(
      normalizeToolResultsFromAssistants(await MessageV2.toModelMessages(msgs, model)),
    )
    for (let i = 0; i < wire.length; i++) {
      const m = wire[i] as { role?: string }
      if (i > 0) {
        const a = wire[i - 1] as { role?: string }
        // the contentless leading assistant was discarded; no consecutive assistants
        expect(!(a.role === "assistant" && m.role === "assistant")).toBe(true)
      }
    }
    // the REAL content survives — the next assistant's answer is still present
    const last = wire[wire.length - 1] as { role?: string; content?: Array<{ type?: string; text?: string }> }
    expect(last.role).toBe("assistant")
  })

  it("C2 honest boundary: a CONTENTFUL leading assistant is preserved, NO content lost (source fix holds)", async () => {
    // With the SOURCE fix in place (toModelMessagesEffect now preserves a user
    // separator between two assistant turns), the contentful leading assistant's
    // real content is intact AND the wire no longer collapses to assistant,assistant
    // — even without C2. This asserts C2/C2 is not dropping real content, and that
    // the source fix (not a boundary crutch) is what keeps the turns alternating.
    const msgs: SessionV1.WithParts[] = [
      lengthAssistantPartialText("msg_len_1", "msg_u1", "real truncated reasoning"), // <-- contentful
      emptyUserMessage("msg_u2"),
      lengthAssistantPartialText("msg_len_2", "msg_u2", "next answer"),
    ]

    const raw = await MessageV2.toModelMessages(msgs, model)
    // WITHOUT C2 — pure renderer output. The source fix must have preserved the
    // separating user, so no consecutive assistants appear.
    const roles = raw.map((m) => (m as { role?: string }).role)

    // the REAL assistant content is preserved untouched (no content loss)
    const leading = raw[0] as { content?: Array<{ type?: string; text?: string }> }
    const leadingHasText = Array.isArray(leading.content) && leading.content.some((p) => p.type === "text")
    expect(leadingHasText).toBe(true)

    // and because the source fix now preserves the separator, no consecutive
    // assistants appear even without C2 (previously this was assistant,assistant)
    for (let i = 1; i < roles.length; i++) {
      expect(!(roles[i - 1] === "assistant" && roles[i] === "assistant")).toBe(true)
    }
  })

  it("control: length-assistant + RENDERABLE user + length-assistant stays separated (no false positive)", async () => {
    const msgs: SessionV1.WithParts[] = [
      lengthAssistantPartialText("msg_len_c1", "msg_u1", "thought a"),
      {
        info: {
          id: MessageID.make("msg_u_c"),
          sessionID,
          role: "user",
          time: { created: 0 },
          parentID: MessageID.make("msg_root"),
          modelID: model.api.id,
          providerID: model.providerID,
        } as unknown as SessionV1.User,
        parts: [
          {
            id: PartID.make("prt_u_c"),
            messageID: MessageID.make("msg_u_c"),
            sessionID,
            type: "text",
            text: "visible user turn",
          } as SessionV1.Part,
        ],
      },
      lengthAssistantPartialText("msg_len_c2", "msg_u_c", "thought b"),
    ]

    const wire = dropContentlessAdjacentAssistant(
      normalizeToolResultsFromAssistants(await MessageV2.toModelMessages(msgs, model)),
    )
    for (let i = 1; i < wire.length; i++) {
      const a = wire[i - 1] as { role?: string }
      const b = wire[i] as { role?: string }
      // a renderable user between the two turns must keep them separated
      expect(!(a.role === "assistant" && b.role === "assistant")).toBe(true)
    }
  })

  it("SOURCE ROOT CAUSE: toModelMessagesEffect must NOT drop a user that separates two assistants", async () => {
    // This is the ROOT CAUSE test that the priority-1 source fix must turn green.
    // The READER (MessageV2.toModelMessages) is the SOURCE of the malformed wire:
    // a user message with no renderable parts is silently dropped by its
    // `userMessage.parts.length > 0` guard, removing the separator between two
    // assistant turns and producing assistant,assistant WITHOUT C2 ever seeing a
    // chance to help (the empty user never even enters the wire). The proper fix
    // is at this source, not as a downstream repair.
    const msgs: SessionV1.WithParts[] = [
      lengthAssistantPartialText("msg_len_r1", "msg_u1", "real content a"),
      emptyUserMessage("msg_u2"), // separates two assistants, renders no parts
      lengthAssistantPartialText("msg_len_r2", "msg_u2", "real content b"),
    ]

    // raw renderer output — NO normalize, NO discard. This isolates the source.
    const raw = await MessageV2.toModelMessages(msgs, model)
    const roles = raw.map((m) => (m as { role?: string }).role)

    // The wire must NOT collapse to assistant,assistant. If it does, the source
    // bug is live (this test FAILS red). After the source fix, a minimal
    // separator is preserved so the turns stay alternating.
    for (let i = 1; i < roles.length; i++) {
      expect(!(roles[i - 1] === "assistant" && roles[i] === "assistant")).toBe(true)
    }
  })
})

describe("Option 1: hasPendingUserContinuation — post-compaction exit decision", () => {
  it("clean-stop compaction with NO continuation user is terminal (no pending work)", () => {
    // A clean compaction produced [compaction-user, summary(stop)] where the
    // summary directly answers the (only) user and no continueMsg exists. This
    // is exactly the field scenario: the loop must BREAK (terminal) rather than
    // do a pointless continue that would immediately early-exit via chiron and
    // read as "returned to user input unexpectedly."
    const msgs: SessionV1.WithParts[] = [
      userMessage("msg_compaction_user"),
      stopAssistant("msg_compaction_summary", "msg_compaction_user"),
    ]
    expect(hasPendingUserContinuation(msgs)).toBe(false)
  })

  it("compaction that appended a continuation user IS still pending (must continue)", () => {
    // The compaction wrote the summary AND the producer appended a continueMsg
    // ("Continue if you have next steps..."). The summary no longer directly
    // answers the LAST user (the continueMsg does), so chiron must NOT fire and
    // the loop must continue to answer the continuation.
    const msgs: SessionV1.WithParts[] = [
      userMessage("msg_compaction_user"),
      stopAssistant("msg_compaction_summary", "msg_compaction_user"),
      userMessage("msg_continue"), // auto-continuation pending user
    ]
    expect(hasPendingUserContinuation(msgs)).toBe(true)
  })

  it("dangling in-flight (non-conclusive) assistant is pending work", () => {
    const msgs: SessionV1.WithParts[] = [
      userMessage("msg_u1"),
      lengthAssistantPartialText("msg_len", "msg_u1", "partial"),
    ]
    expect(hasPendingUserContinuation(msgs)).toBe(true)
  })
})
