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
      type: "session.input.admitted",
      data: {
        sessionID: "ses_1",
        inputID: "msg_user",
        input: { type: "user", delivery: "steer", data: { text: "hello" } },
      },
    })
    apply({
      ...base,
      id: "evt_promoted",
      type: "session.input.promoted",
      data: { sessionID: "ses_1", inputID: "msg_user" },
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
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "bash" },
    })
    apply({
      ...base,
      id: "evt_tool_delta",
      type: "session.tool.input.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", delta: "{}" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_success",
      type: "session.tool.success",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
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

  test("preserves current structured progress and success payloads", () => {
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
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "visualization_create" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_progress",
      type: "session.tool.progress",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        structured: { version: 1, title: "Loading" },
        metadata: { legacy: "progress" },
      },
    })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      content: [{ type: "tool", state: { status: "running", structured: { version: 1, title: "Loading" } } }],
    })
    const progress = messages[0]?.type === "assistant" ? messages[0].content[0] : undefined
    expect(progress).toMatchObject({ executed: true, time: { created: 1, ran: 1 } })
    expect<unknown>(progress?.type === "tool" ? progress.state : undefined).toEqual({
      status: "running",
      input: {},
      structured: { version: 1, title: "Loading" },
      metadata: { legacy: "progress" },
    })

    apply({
      ...base,
      id: "evt_tool_success",
      type: "session.tool.success",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        structured: { version: 1, title: "Chart", html: "<div>chart</div>" },
        metadata: { legacy: "success" },
        content: [{ type: "text", text: "Visualization created" }],
        executed: true,
      },
    })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      content: [
        {
          type: "tool",
          state: {
            status: "completed",
            structured: { version: 1, title: "Chart", html: "<div>chart</div>" },
            metadata: { legacy: "success" },
          },
        },
      ],
    })
    const success = messages[0]?.type === "assistant" ? messages[0].content[0] : undefined
    expect(success).toMatchObject({ executed: true, time: { created: 1, ran: 1, completed: 1 } })
    expect<unknown>(success?.type === "tool" ? success.state : undefined).toEqual({
      status: "completed",
      input: {},
      structured: { version: 1, title: "Chart", html: "<div>chart</div>" },
      metadata: { legacy: "success" },
      content: [{ type: "text", text: "Visualization created" }],
    })
  })

  test("uses legacy metadata as structured tool data", () => {
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
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "legacy" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_success",
      type: "session.tool.success",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        metadata: { legacy: true },
        content: [{ type: "text", text: "done" }],
        executed: true,
      },
    })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      content: [{ type: "tool", state: { status: "completed", structured: { legacy: true } } }],
    })
  })

  test("keeps running structured data when a tool fails", () => {
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
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "visualization_create" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        input: {},
        metadata: { phase: "called" },
        executed: true,
      },
    })
    apply({
      ...base,
      id: "evt_tool_progress",
      type: "session.tool.progress",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        structured: { version: 1, title: "Partial" },
      },
    })
    apply({
      ...base,
      id: "evt_tool_failed",
      type: "session.tool.failed",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        metadata: { provider: "failure" },
        content: [{ type: "text", text: "partial" }],
        error: { type: "unknown", message: "failed" },
        executed: true,
      },
    })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      content: [
        {
          type: "tool",
          state: {
            status: "error",
            structured: { version: 1, title: "Partial" },
            metadata: { provider: "failure" },
          },
        },
      ],
    })
  })

  test("uses failed legacy metadata when called state has no explicit structured field", () => {
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
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "legacy" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_failed",
      type: "session.tool.failed",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        metadata: { legacy: true },
        content: [{ type: "text", text: "failed output" }],
        error: { type: "unknown", message: "failed" },
        executed: true,
      },
    })

    const failed = messages[0]?.type === "assistant" ? messages[0].content[0] : undefined
    expect(failed).toMatchObject({ executed: true, time: { created: 1, ran: 1, completed: 1 } })
    expect<unknown>(failed?.type === "tool" ? failed.state : undefined).toEqual({
      status: "error",
      input: {},
      structured: { legacy: true },
      metadata: { legacy: true },
      content: [{ type: "text", text: "failed output" }],
      error: { type: "unknown", message: "failed" },
    })
  })

  test("requests hydration when promotion admission was missed", () => {
    const result = createV2SessionReducer().reduce(
      [],
      event({
        ...base,
        id: "evt_promoted",
        type: "session.input.promoted",
        data: { sessionID: "ses_1", inputID: "msg_user" },
      }),
    )

    expect(result).toMatchObject({ sessionID: "ses_1", missing: "msg_user", touched: [] })
  })
})
