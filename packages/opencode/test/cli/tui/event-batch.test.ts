import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "../../../src/bus/global"
import { collapseEventBatch, shouldForwardEvent } from "../../../src/cli/tui/event-batch"

const delta = (input: {
  delta?: string
  id?: string
  sessionID?: string
  messageID?: string
  partID?: string
  field?: string
  directory?: string
  project?: string
  workspace?: string
}): GlobalEvent => ({
  directory: input.directory,
  project: input.project,
  workspace: input.workspace,
  payload: {
    id: input.id,
    type: "message.part.delta",
    properties: {
      sessionID: input.sessionID ?? "ses_1",
      messageID: input.messageID ?? "msg_1",
      partID: input.partID ?? "prt_1",
      field: input.field ?? "text",
      delta: input.delta,
    },
  },
})

const partUpdated: GlobalEvent = {
  payload: { type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "prt_1" } } },
}

describe("collapseEventBatch", () => {
  test("merges adjacent deltas for the same part field", () => {
    const collapsed = collapseEventBatch([
      delta({ delta: "a", id: "evt_1" }),
      delta({ delta: "b" }),
      delta({ delta: "c" }),
    ])

    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].payload.properties.delta).toBe("abc")
    // The merged event keeps the first event's identity.
    expect(collapsed[0].payload.id).toBe("evt_1")
  })

  test("keeps deltas for different parts separate", () => {
    const collapsed = collapseEventBatch([delta({ delta: "a" }), delta({ delta: "b", partID: "prt_2" })])

    expect(collapsed).toHaveLength(2)
    expect(collapsed.map((event) => event.payload.properties.delta)).toEqual(["a", "b"])
  })

  test("keeps deltas for different fields separate", () => {
    const collapsed = collapseEventBatch([delta({ delta: "a", field: "text" }), delta({ delta: "b", field: "other" })])

    expect(collapsed).toHaveLength(2)
  })

  test("does not merge across a non-delta event", () => {
    const collapsed = collapseEventBatch([delta({ delta: "a" }), partUpdated, delta({ delta: "b" })])

    expect(collapsed).toHaveLength(3)
    expect(collapsed.map((event) => event.payload.type)).toEqual([
      "message.part.delta",
      "message.part.updated",
      "message.part.delta",
    ])
  })

  test("merges non-adjacent deltas for the same part", () => {
    const collapsed = collapseEventBatch([
      delta({ delta: "a", partID: "prt_1" }),
      delta({ delta: "b", partID: "prt_2" }),
      delta({ delta: "c", partID: "prt_1" }),
    ])

    expect(collapsed).toHaveLength(2)
    expect(collapsed.map((event) => event.payload.properties.partID)).toEqual(["prt_1", "prt_2"])
    expect(collapsed[0]?.payload.properties.delta).toBe("ac")
    expect(collapsed[1]?.payload.properties.delta).toBe("b")
  })

  test("merges same-part deltas across an unrelated part update", () => {
    const otherPart = {
      payload: { type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "prt_2" } } },
    }
    const collapsed = collapseEventBatch([
      delta({ delta: "a", partID: "prt_1" }),
      otherPart,
      delta({ delta: "b", partID: "prt_1" }),
    ])

    expect(collapsed).toHaveLength(2)
    expect(collapsed[0]?.payload.properties.delta).toBe("ab")
  })

  test("does not merge deltas from different instances", () => {
    const collapsed = collapseEventBatch([
      delta({ delta: "a", directory: "/one" }),
      delta({ delta: "b", directory: "/two" }),
    ])

    expect(collapsed).toHaveLength(2)
  })

  test("does not merge when a delta payload is malformed", () => {
    const collapsed = collapseEventBatch([delta({ delta: "a" }), delta({ delta: undefined })])

    expect(collapsed).toHaveLength(2)
  })

  test("returns an empty batch unchanged", () => {
    expect(collapseEventBatch([])).toEqual([])
  })
})

describe("shouldForwardEvent", () => {
  test("drops bridge sync mirrors", () => {
    expect(shouldForwardEvent({ payload: { type: "sync" } })).toBe(false)
  })

  test("forwards regular events", () => {
    expect(shouldForwardEvent(partUpdated)).toBe(true)
    expect(shouldForwardEvent(delta({ delta: "a" }))).toBe(true)
  })
})
