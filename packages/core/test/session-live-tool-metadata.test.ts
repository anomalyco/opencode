import { describe, expect, test } from "bun:test"
import * as LiveToolMetadata from "../src/session/runner/live-tool-metadata"

const message = (status: string) => ({
  type: "assistant",
  id: "msg_live",
  content: [
    { type: "text", id: "text" },
    { type: "tool", id: "call_1", state: { status, metadata: {} } },
  ],
})

describe("LiveToolMetadata.overlay", () => {
  test("adds progress to running tool parts until the call settles", () => {
    LiveToolMetadata.set("msg_live", "call_1", { background: true, toolCalls: [] })
    expect(LiveToolMetadata.overlay(message("running")).content[1]).toMatchObject({
      state: { status: "running", metadata: { background: true, toolCalls: [] } },
    })
    expect(LiveToolMetadata.overlay(message("completed")).content[1]).toEqual(message("completed").content[1])

    LiveToolMetadata.clear("msg_live", "call_1")
    expect(LiveToolMetadata.overlay(message("running"))).toEqual(message("running"))
  })
})
