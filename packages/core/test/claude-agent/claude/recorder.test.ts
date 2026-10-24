import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { Recorder } from "../lib/recorder"

describe("recording privacy", () => {
  test("drops thinking events and strips nested thinking from messages", () => {
    const blocks = [
      { type: "thinking", thinking: "DO-NOT-SAVE", signature: "DO-NOT-SAVE" },
      { type: "redacted_thinking", data: "DO-NOT-SAVE" },
      { type: "reasoning", text: "DO-NOT-SAVE" },
    ]
    for (const block of blocks) {
      const event = { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: block } }
      expect(Recorder.parse(JSON.stringify(event))).toBeUndefined()
    }
    for (const delta of [
      { type: "thinking_delta", thinking: "DO-NOT-SAVE" },
      { type: "signature_delta", signature: "DO-NOT-SAVE" },
    ]) {
      const event = { type: "stream_event", event: { type: "content_block_delta", index: 0, delta } }
      expect(Recorder.parse(JSON.stringify(event))).toBeUndefined()
    }
    const text = { type: "text", text: "Visible answer" }
    for (const type of ["assistant", "user"]) {
      const input = { type, message: { content: [...blocks, text] } }
      expect(Recorder.parse(JSON.stringify(input))).toEqual({ type, message: { content: [text] } })
    }
    const event = {
      type: "stream_event",
      event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Visible answer" } },
    }
    expect(Recorder.parse(JSON.stringify(event))).toEqual(event)
  })

  test("checked-in recordings contain no thinking blocks or deltas", () => {
    const directory = path.join(import.meta.dir, "../fixtures/recordings")
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(".jsonl")) continue
      const lines = readFileSync(path.join(directory, name), "utf8").trim().split("\n")
      for (const line of lines) {
        // Compare booleans so failures cannot print the offending content.
        const unchanged = JSON.stringify(Recorder.parse(line)) === JSON.stringify(JSON.parse(line))
        expect(unchanged, name).toBe(true)
      }
    }
  })
})
