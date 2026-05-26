import { describe, expect, test } from "bun:test"
import { adapterState, toLLMEvents, type RealtimeEvent } from "../../src/session/llm/realtime"

function run(events: RealtimeEvent[]) {
  const state = adapterState()
  return events.flatMap((e) => toLLMEvents(state, e))
}

describe("session.llm.realtime.toLLMEvents", () => {
  test("text turn: response.created -> text deltas -> text done -> response.done", () => {
    const out = run([
      { type: "session.created" },
      { type: "response.created" },
      { type: "response.output_item.added", item: { id: "msg_1", type: "message" } },
      { type: "response.output_text.delta", item_id: "msg_1", delta: "Hello" },
      { type: "response.output_text.delta", item_id: "msg_1", delta: " world" },
      { type: "response.output_text.done", item_id: "msg_1" },
      { type: "response.done", response: { status: "completed" } },
    ])

    const types = out.map((e) => e.type)
    expect(types).toEqual([
      "step-start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "step-finish",
      "finish",
    ])
    expect(out.filter((e) => e.type === "text-delta").map((e: any) => e.text).join("")).toBe("Hello world")
  })

  test("tool call: function_call item -> argument deltas -> output_item.done emits toolCall with parsed args", () => {
    const out = run([
      { type: "response.created" },
      {
        type: "response.output_item.added",
        item: { id: "item_1", type: "function_call", call_id: "call_abc", name: "read_file" },
      },
      { type: "response.function_call_arguments.delta", call_id: "call_abc", delta: '{"path"' },
      { type: "response.function_call_arguments.delta", call_id: "call_abc", delta: ':"a.txt"}' },
      { type: "response.function_call_arguments.done", call_id: "call_abc" },
      {
        type: "response.output_item.done",
        item: { id: "item_1", type: "function_call", call_id: "call_abc", arguments: '{"path":"a.txt"}' },
      },
      { type: "response.done" },
    ])

    const tc = out.find((e) => e.type === "tool-call") as any
    expect(tc).toBeDefined()
    expect(tc.id).toBe("call_abc")
    expect(tc.name).toBe("read_file")
    expect(tc.input).toEqual({ path: "a.txt" })

    const inputDeltas = out.filter((e) => e.type === "tool-input-delta") as any[]
    expect(inputDeltas.map((d) => d.text).join("")).toBe('{"path":"a.txt"}')
  })

  test("unknown event types and out-of-order text deltas are dropped without throwing", () => {
    const out = run([
      { type: "rate_limits.updated" } as any,
      { type: "response.audio.delta", delta: "..." } as any,
      // delta without a matching active text id is silently dropped
      { type: "response.output_text.delta", delta: "stray" },
    ])
    expect(out).toEqual([])
  })

  test("response.done with status=failed surfaces reason=error on stepFinish + finish", () => {
    const out = run([
      { type: "response.created" },
      { type: "response.done", response: { status: "failed" } },
    ])
    const finish = out.find((e) => e.type === "finish") as any
    const step = out.find((e) => e.type === "step-finish") as any
    expect(finish.reason).toBe("error")
    expect(step.reason).toBe("error")
  })
})
