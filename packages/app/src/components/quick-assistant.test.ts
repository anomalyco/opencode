import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { context, isSessionNotFoundError, mergeMessages, prompt } from "./quick-assistant/helpers"

const msg = (id: string, role: "user" | "assistant") =>
  ({
    id,
    sessionID: "ses_1",
    role,
    time: { created: 1 },
    agent: "assistant",
    model: { providerID: "openai", modelID: "gpt-5" },
  }) as Message

describe("mergeMessages", () => {
  test("preserves optimistic messages when fetched history is stale", () => {
    const result = mergeMessages([msg("msg_2", "user")], [])
    expect(result.map((item) => item.id)).toEqual(["msg_2"])
  })

  test("deduplicates by id and keeps fetched updates", () => {
    const result = mergeMessages([msg("msg_1", "user")], [msg("msg_1", "assistant"), msg("msg_2", "assistant")])
    expect(result.map((item) => `${item.id}:${item.role}`)).toEqual(["msg_1:assistant", "msg_2:assistant"])
  })
})

describe("quick assistant prompt", () => {
  test("omits current session context by default", () => {
    expect(prompt("ship it", "<current-opencode-session>\nfoo\n</current-opencode-session>", false)).toBe("ship it")
  })

  test("prepends current session context when enabled", () => {
    expect(prompt("ship it", "<current-opencode-session>\nfoo\n</current-opencode-session>", true)).toBe(
      "<current-opencode-session>\nfoo\n</current-opencode-session>\n\nship it",
    )
  })

  test("renders current session context block", () => {
    expect(context("/repo", "ses_1", { title: "Demo" } as any, 7)).toBe(
      [
        "<current-opencode-session>",
        "directory: /repo",
        "session_id: ses_1",
        "title: Demo",
        "message_count: 7",
        "</current-opencode-session>",
      ].join("\n"),
    )
  })
})

describe("quick assistant session error handling", () => {
  test("recognizes generated SDK throwOnError not-found errors", () => {
    const err = new Error("Session not found: ses_missing", {
      cause: {
        status: 404,
        body: {
          name: "NotFoundError",
          data: { message: "Session not found: ses_missing" },
        },
      },
    })

    expect(isSessionNotFoundError(err)).toBe(true)
  })

  test("recognizes v2 session not-found errors", () => {
    expect(
      isSessionNotFoundError({
        cause: {
          body: {
            name: "SessionNotFoundError",
            data: { sessionID: "ses_missing" },
          },
        },
      }),
    ).toBe(true)
  })

  test("does not treat unrelated errors as missing sessions", () => {
    expect(isSessionNotFoundError(new Error("network failed"))).toBe(false)
    expect(isSessionNotFoundError({ name: "ProviderModelNotFoundError" })).toBe(false)
  })
})
