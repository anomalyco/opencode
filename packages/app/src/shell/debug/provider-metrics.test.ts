import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import type { ProviderMetricEvent } from "./provider-metrics"
import { foldProviderMetrics, projectedProviderMetrics } from "./provider-metrics"

const durable = { aggregateID: "ses_test", seq: 0, version: 1 } as const

const events: ProviderMetricEvent[] = [
  {
    id: "evt_started",
    created: 1_000,
    type: "session.step.started",
    durable,
    data: {
      sessionID: "ses_test",
      assistantMessageID: "msg_assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      started: 1_000,
    },
  },
  {
    id: "evt_reasoning",
    created: 1_300,
    type: "session.reasoning.started",
    durable: { ...durable, seq: 1 },
    data: { sessionID: "ses_test", assistantMessageID: "msg_assistant", ordinal: 0 },
  },
  {
    id: "evt_text",
    created: 1_800,
    type: "session.text.started",
    durable: { ...durable, seq: 2 },
    data: { sessionID: "ses_test", assistantMessageID: "msg_assistant", ordinal: 0 },
  },
  {
    id: "evt_streamed",
    created: 3_800,
    type: "session.step.streamed",
    durable: { ...durable, seq: 3 },
    data: { sessionID: "ses_test", assistantMessageID: "msg_assistant" },
  },
  {
    id: "evt_ended",
    created: 4_000,
    type: "session.step.ended",
    durable: { ...durable, seq: 4 },
    data: {
      sessionID: "ses_test",
      assistantMessageID: "msg_assistant",
      finish: "stop",
      cost: 0,
      tokens: { input: 200, output: 100, reasoning: 20, cache: { read: 0, write: 0 } },
    },
  },
]

test("calculates provider response metrics from durable events", () => {
  expect(foldProviderMetrics(events)).toEqual({
    tps: 50,
    ttft: 300,
    ttfa: 800,
    e2e: 2_800,
  })
})

test("ignores failed attempts without usage", () => {
  expect(
    foldProviderMetrics([
      ...events.slice(0, 4),
      {
        id: "evt_failed",
        created: 4_000,
        type: "session.step.failed",
        durable: { ...durable, seq: 4 },
        data: {
          sessionID: "ses_test",
          assistantMessageID: "msg_assistant",
          error: { type: "aborted", message: "Step interrupted" },
        },
      },
    ]),
  ).toBeUndefined()
})

test("keeps completed metrics while the next provider attempt runs", () => {
  expect(
    foldProviderMetrics([
      ...events,
      {
        id: "evt_retry",
        created: 5_000,
        type: "session.step.started",
        durable: { ...durable, seq: 5 },
        data: {
          sessionID: "ses_test",
          assistantMessageID: "msg_assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          started: 5_000,
        },
      },
    ]),
  ).toEqual(foldProviderMetrics(events))
})

const assistant: SessionMessageAssistant = {
  id: "msg_assistant",
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [
    { type: "reasoning", text: "Think", time: { created: 1_300, completed: 1_700 } },
    { type: "text", text: "Answer" },
  ],
  tokens: { input: 200, output: 100, reasoning: 20, cache: { read: 0, write: 0 } },
  time: { created: 1_000, streamed: 3_800, completed: 4_000 },
}

test("derives a baseline from the latest completed projected request", () => {
  const messages: SessionMessageInfo[] = [
    { id: "msg_user", type: "user", text: "Hi", time: { created: 1 } },
    assistant,
    { ...assistant, id: "msg_running", tokens: undefined, time: { created: 5_000 } },
  ]
  // Reasoning ended at 1_700, so TPS spans 1_700 → 3_800 = 100 / 2.1s.
  expect(projectedProviderMetrics(messages)).toEqual({ tps: 100 / 2.1, ttft: 300, ttfa: 700, e2e: 2_800 })
})

const tool = (created: number): SessionMessageAssistant["content"][number] => ({
  type: "tool",
  id: "call_1",
  name: "read",
  state: { status: "running", input: {}, metadata: {} },
  time: { created, ran: created + 100 },
})

test("leaves text-first history unavailable until a live request", () => {
  const unavailable = { tps: undefined, ttft: undefined, ttfa: undefined, e2e: 2_800 }
  expect(projectedProviderMetrics([{ ...assistant, content: [{ type: "text", text: "Answer" }] }])).toEqual(unavailable)
  expect(
    projectedProviderMetrics([{ ...assistant, content: [{ type: "text", text: "Answer" }, tool(2_500)] }]),
  ).toEqual(unavailable)
})

test("uses the first tool call as first output for tool-first history", () => {
  expect(projectedProviderMetrics([{ ...assistant, content: [tool(1_800)] }])).toEqual({
    tps: 50,
    ttft: 800,
    ttfa: undefined,
    e2e: 2_800,
  })
})
