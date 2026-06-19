import { describe, expect, test } from "bun:test"
import { coalesceServerEvents, resumeStreamAfterPageShow } from "./server-sdk"
import type { Event } from "@opencode-ai/sdk/v2/client"

describe("resumeStreamAfterPageShow", () => {
  test("restarts a stream only after a back-forward cache restore", () => {
    let starts = 0
    const start = () => starts++

    resumeStreamAfterPageShow({ persisted: false } as PageTransitionEvent, start)
    resumeStreamAfterPageShow({ persisted: true } as PageTransitionEvent, start)

    expect(starts).toBe(1)
  })
})

describe("coalesceServerEvents", () => {
  const delta = (value: string, field = "text") => ({
    directory: "/repo",
    payload: {
      type: "message.part.delta",
      properties: { messageID: "msg", partID: "part", field, delta: value },
    } as Event,
  })

  test("merges adjacent deltas for the same field", () => {
    const result = coalesceServerEvents([delta("hello "), delta("world")])

    expect(result).toHaveLength(1)
    expect(result[0]?.payload).toMatchObject({ properties: { delta: "hello world" } })
  })

  test("preserves event boundaries and distinct fields", () => {
    const status = {
      directory: "/repo",
      payload: { type: "session.status", properties: { sessionID: "ses", status: { type: "idle" } } } as Event,
    }
    const result = coalesceServerEvents([delta("a"), delta("b", "metadata"), status, delta("c")])

    expect(result.map((event) => event.payload.type)).toEqual([
      "message.part.delta",
      "message.part.delta",
      "session.status",
      "message.part.delta",
    ])
  })

  test("drops stale deltas", () => {
    const result = coalesceServerEvents([delta("stale")], new Set(["/repo:msg:part"]))

    expect(result).toEqual([])
  })
})
