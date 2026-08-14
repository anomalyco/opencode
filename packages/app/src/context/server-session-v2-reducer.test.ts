import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"
import { createV2SessionReducer } from "./server-session-v2-reducer"

const event = (input: object) => input as OpenCodeEvent
const base = { created: 1, location: { directory: "/repo" }, durable: { aggregateID: "ses_1", seq: 1, version: 1 } }

describe("v2 session reducer", () => {
  test("projects promoted input and streaming assistant content", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }

    apply({
      ...base,
      id: "evt_admitted",
      type: "session.inbox.enqueued",
      data: {
        sessionID: "ses_1",
        inboxID: "msg_user",
        item: { type: "user", delivery: "steer", payload: { text: "hello" } },
      },
    })
    apply({
      ...base,
      id: "evt_promoted",
      type: "session.inbox.delivered",
      data: { sessionID: "ses_1", inboxID: "msg_user" },
    })
    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_text_start",
      type: "session.text.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0 },
    })
    apply({
      ...base,
      id: "evt_text_delta",
      type: "session.text.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, delta: "hel" },
    })
    apply({
      ...base,
      id: "evt_text_end",
      type: "session.text.ended",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, text: "hello" },
    })

    expect(messages[0]).toMatchObject({ id: "msg_user", type: "user", text: "hello" })
    expect(messages[1]).toMatchObject({
      id: "msg_assistant",
      type: "assistant",
      content: [{ type: "text", text: "hello" }],
    })
  })

  test("prefers durable selection predecessors and derives them for older events", () => {
    const source: SessionMessageInfo[] = [
      { id: "msg_previous_agent", type: "agent-switched", agent: "build", time: { created: 1 } },
      {
        id: "msg_previous_model",
        type: "model-switched",
        model: { id: "old", providerID: "provider" },
        time: { created: 1 },
      },
    ]
    const reducer = createV2SessionReducer()

    const agent = reducer.reduce(
      source,
      event({
        ...base,
        id: "evt_agent",
        type: "session.agent.selected",
        data: { sessionID: "ses_1", agent: "plan", previous: "review" },
      }),
    )
    const model = reducer.reduce(
      source,
      event({
        ...base,
        id: "evt_model",
        type: "session.model.selected",
        data: {
          sessionID: "ses_1",
          model: { id: "new", providerID: "provider" },
          previous: { id: "durable", providerID: "provider" },
        },
      }),
    )
    const legacyAgent = reducer.reduce(
      source,
      event({
        ...base,
        id: "evt_legacy_agent",
        type: "session.agent.selected",
        data: { sessionID: "ses_1", agent: "plan" },
      }),
    )

    expect(agent?.messages.at(-1)).toMatchObject({ type: "agent-switched", agent: "plan", previous: "review" })
    expect(model?.messages.at(-1)).toMatchObject({
      type: "model-switched",
      model: { id: "new" },
      previous: { id: "durable" },
    })
    expect(legacyAgent?.messages.at(-1)).toMatchObject({
      type: "agent-switched",
      agent: "plan",
      previous: "build",
    })
  })

  test("folds tool, retry, and completion events", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
    }

    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_tool_start",
      type: "session.tool.input.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", id: "call_1", name: "bash" },
    })
    apply({
      ...base,
      id: "evt_tool_delta",
      type: "session.tool.input.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", id: "call_1", delta: "{}" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", id: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_success",
      type: "session.tool.success",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        id: "call_1",
        metadata: {},
        content: [{ type: "text", text: "done" }],
        executed: true,
      },
    })
    apply({
      ...base,
      id: "evt_retry",
      type: "session.retry.scheduled",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        attempt: 2,
        at: 10,
        error: { type: "ProviderError", message: "retry" },
      },
    })
    apply({ ...base, id: "evt_done", type: "session.execution.succeeded", data: { sessionID: "ses_1" } })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      retry: undefined,
      content: [{ type: "tool", id: "call_1", state: { status: "completed", content: [{ text: "done" }] } }],
    })
  })

  test("requests hydration when promotion admission was missed", () => {
    const result = createV2SessionReducer().reduce(
      [],
      event({
        ...base,
        id: "evt_promoted",
        type: "session.inbox.delivered",
        data: { sessionID: "ses_1", inboxID: "msg_user" },
      }),
    )

    expect(result).toMatchObject({ sessionID: "ses_1", missing: "msg_user", touched: [] })
  })

  test("projects rendered instruction updates", () => {
    const reducer = createV2SessionReducer()
    const result = reducer.reduce(
      [],
      event({
        ...base,
        id: "evt_instructions",
        type: "session.instructions.updated",
        data: { sessionID: "ses_1", delta: { agents: "hash" }, text: "Changed instructions" },
      }),
    )

    expect(result?.messages).toEqual([
      {
        id: "msg_instructions",
        type: "system",
        text: "Changed instructions",
        description: "Instructions updated: agents",
        metadata: undefined,
        time: { created: 1 },
      },
    ])
  })

  test("projects session movement with the previous location", () => {
    const result = createV2SessionReducer().reduce(
      [],
      event({
        ...base,
        id: "evt_moved",
        type: "session.moved",
        data: {
          sessionID: "ses_1",
          projectID: "project_2",
          location: { directory: "/repo-2" },
          subpath: "packages/app",
        },
      }),
      { projectID: "project_1", location: { directory: "/repo-1" } },
    )

    expect(result?.messages).toMatchObject([
      {
        id: "msg_moved",
        type: "location-switched",
        projectID: "project_2",
        location: { directory: "/repo-2" },
        previous: { projectID: "project_1", location: { directory: "/repo-1" } },
      },
    ])
  })

  test("removes cancelled input from the pending promotion fold", () => {
    const reducer = createV2SessionReducer()
    reducer.reduce(
      [],
      event({
        ...base,
        id: "evt_admitted",
        type: "session.inbox.enqueued",
        data: {
          sessionID: "ses_1",
          inboxID: "msg_user",
          item: { type: "user", delivery: "queue", payload: { text: "cancel me" } },
        },
      }),
    )
    reducer.reduce(
      [],
      event({
        ...base,
        id: "evt_cancelled",
        type: "session.inbox.cancelled",
        data: { sessionID: "ses_1", inboxID: "msg_user" },
      }),
    )
    const result = reducer.reduce(
      [],
      event({
        ...base,
        id: "evt_promoted",
        type: "session.inbox.delivered",
        data: { sessionID: "ses_1", inboxID: "msg_user" },
      }),
    )

    expect(result).toMatchObject({ missing: "msg_user" })
  })

  test("keeps steered input available to the promotion fold", () => {
    const reducer = createV2SessionReducer()
    reducer.reduce(
      [],
      event({
        ...base,
        id: "evt_admitted",
        type: "session.inbox.enqueued",
        data: {
          sessionID: "ses_1",
          inboxID: "msg_user",
          item: { type: "user", delivery: "queue", payload: { text: "steer me" } },
        },
      }),
    )
    reducer.reduce(
      [],
      event({
        ...base,
        id: "evt_steered",
        type: "session.inbox.delivery.changed",
        data: { sessionID: "ses_1", inboxID: "msg_user", delivery: "steer" },
      }),
    )
    reducer.reduce(
      [],
      event({
        ...base,
        id: "evt_queued",
        type: "session.inbox.delivery.changed",
        data: { sessionID: "ses_1", inboxID: "msg_user", delivery: "queue" },
      }),
    )

    const result = reducer.reduce(
      [],
      event({
        ...base,
        id: "evt_promoted",
        type: "session.inbox.delivered",
        data: { sessionID: "ses_1", inboxID: "msg_user" },
      }),
    )

    expect(result?.messages).toMatchObject([{ id: "msg_user", type: "user", text: "steer me" }])
  })
})
