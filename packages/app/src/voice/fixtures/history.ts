import type { SessionMessageInfo } from "@opencode/client/promise"

// Recorded from this implementation session's GET /message on 2026-10-22.
// IDs, text, agent and model are redacted. Timing, order, finish and idle
// boundaries are preserved; empty tool-only steps are omitted.
export const history = [
  { id: "msg_recorded_0", type: "user", time: { created: 1792694671208 }, text: "Request 0" },
  {
    id: "msg_recorded_6",
    type: "assistant",
    time: { created: 1792694746010, streamed: 1792694766020, completed: 1792694766230 },
    agent: "build",
    model: { id: "fixture", providerID: "fixture" },
    content: [{ type: "text", text: "Reply 6" }],
    finish: "tool-calls",
  },
  {
    id: "msg_recorded_16",
    type: "assistant",
    time: { created: 1792695056098, streamed: 1792695070413, completed: 1792695070418 },
    agent: "build",
    model: { id: "fixture", providerID: "fixture" },
    content: [{ type: "text", text: "Reply 16" }],
    finish: "stop",
  },
  { id: "msg_recorded_17", type: "idle", time: { created: 1792695070426 }, outcome: "succeeded" },
  { id: "msg_recorded_18", type: "user", time: { created: 1792695348400 }, text: "Request 18" },
  {
    id: "msg_recorded_19",
    type: "assistant",
    time: { created: 1792695348413, streamed: 1792695360066, completed: 1792695360145 },
    agent: "build",
    model: { id: "fixture", providerID: "fixture" },
    content: [{ type: "text", text: "Reply 19" }],
    finish: "tool-calls",
  },
  {
    id: "msg_recorded_32",
    type: "assistant",
    time: { created: 1792695648785, streamed: 1792695664164, completed: 1792695664170 },
    agent: "build",
    model: { id: "fixture", providerID: "fixture" },
    content: [{ type: "text", text: "Reply 32" }],
    finish: "stop",
  },
  { id: "msg_recorded_33", type: "idle", time: { created: 1792695664181 }, outcome: "succeeded" },
] satisfies SessionMessageInfo[]

// The second muted transport probe's recorded output transcript, coalesced
// from its eight deltas. No input-transcript event was observed in that probe.
export const speech = { at: 10_210, end: 12_170, text: "Yes, your mic is working. I can hear you clearly." }
