import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { Agent } from "@opencode/schema/agent"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionID } from "@opencode/schema/session-id"
import { Event } from "@opencode/schema/event"
import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import type { ProviderMetricEvent, ProviderMetricState } from "./metrics"
import { applyProviderMetricEvent, projectedProviderMetrics } from "./metrics"

const durable = { aggregateID: "ses_test", seq: 0, version: 1 } as const

const events: ProviderMetricEvent[] = [
  {
    id: Event.ID.make("evt_started", { disableChecks: true }),
    created: 1_000,
    type: "session.step.started",
    durable,
    data: {
      sessionID: SessionID.make("ses_test", { disableChecks: true }),
      assistantMessageID: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
      agent: Agent.ID.make("build", { disableChecks: true }),
      model: {
        id: Model.ID.make("model", { disableChecks: true }),
        providerID: Provider.ID.make("provider", { disableChecks: true }),
      },
      started: 1_000,
    },
  },
  {
    id: Event.ID.make("evt_reasoning", { disableChecks: true }),
    created: 1_300,
    type: "session.reasoning.started",
    durable: { ...durable, seq: 1 },
    data: {
      sessionID: SessionID.make("ses_test", { disableChecks: true }),
      assistantMessageID: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
      ordinal: 0,
    },
  },
  {
    id: Event.ID.make("evt_text", { disableChecks: true }),
    created: 1_800,
    type: "session.text.started",
    durable: { ...durable, seq: 2 },
    data: {
      sessionID: SessionID.make("ses_test", { disableChecks: true }),
      assistantMessageID: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
      ordinal: 0,
    },
  },
  {
    id: Event.ID.make("evt_streamed", { disableChecks: true }),
    created: 3_800,
    type: "session.step.streamed",
    durable: { ...durable, seq: 3 },
    data: {
      sessionID: SessionID.make("ses_test", { disableChecks: true }),
      assistantMessageID: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
    },
  },
  {
    id: Event.ID.make("evt_ended", { disableChecks: true }),
    created: 4_000,
    type: "session.step.ended",
    durable: { ...durable, seq: 4 },
    data: {
      sessionID: SessionID.make("ses_test", { disableChecks: true }),
      assistantMessageID: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
      finish: "stop",
      cost: 0,
      tokens: { input: 200, output: 100, reasoning: 20, cache: { read: 0, write: 0 } },
    },
  },
]

test("calculates provider response metrics from durable events", () => {
  const state: ProviderMetricState = {}
  events.forEach((event) => applyProviderMetricEvent(state, event))
  expect(state.latest).toEqual({
    tps: 50,
    ttft: 300,
    ttfa: 800,
    e2e: 2_800,
  })
})

const assistant: SessionMessageAssistant = {
  id: SessionMessage.ID.make("msg_assistant", { disableChecks: true }),
  type: "assistant",
  agent: Agent.ID.make("build", { disableChecks: true }),
  model: {
    id: Model.ID.make("model", { disableChecks: true }),
    providerID: Provider.ID.make("provider", { disableChecks: true }),
  },
  content: [
    { type: "reasoning", text: "Think", time: { created: 1_300, completed: 1_700 } },
    { type: "text", text: "Answer" },
  ],
  tokens: { input: 200, output: 100, reasoning: 20, cache: { read: 0, write: 0 } },
  time: { created: 1_000, streamed: 3_800, completed: 4_000 },
}

test("derives a baseline from the latest completed projected request", () => {
  const messages: SessionMessageInfo[] = [
    { id: SessionMessage.ID.make("msg_user", { disableChecks: true }), type: "user", text: "Hi", time: { created: 1 } },
    assistant,
    {
      ...assistant,
      id: SessionMessage.ID.make("msg_running", { disableChecks: true }),
      tokens: undefined,
      time: { created: 5_000 },
    },
  ]

  // Reasoning ended at 1_700, so TPS spans 1_700 → 3_800 = 100 / 2.1s.
  expect(projectedProviderMetrics(messages)).toEqual({ tps: 100 / 2.1, ttft: 300, ttfa: 700, e2e: 2_800 })
})
