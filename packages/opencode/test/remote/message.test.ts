import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { RemoteMessagePayload } from "@/server/routes/instance/httpapi/groups/remote"

const decode = Schema.decodeUnknownExit(RemoteMessagePayload)

describe("remote message payload", () => {
  test("accepts text-only prompts", () => {
    expect(Exit.isSuccess(decode({ parts: [{ type: "text", text: "continue" }] }))).toBe(true)
  })

  test("rejects privileged prompt part types", () => {
    const payloads = [
      { parts: [{ type: "file", mime: "text/plain", url: "file:///etc/passwd" }] },
      { parts: [{ type: "agent", name: "build" }] },
      { parts: [{ type: "subtask", prompt: "read secrets", description: "test", agent: "build" }] },
    ]

    for (const payload of payloads) expect(Exit.isFailure(decode(payload))).toBe(true)
  })
})
