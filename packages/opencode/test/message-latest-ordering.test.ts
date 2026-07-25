import { describe, expect, test } from "bun:test"

import { MessageV2 } from "../src/session/message-v2"

/**
 * `latest()` used to pick the newest user/assistant message by comparing ids as
 * plain strings. That holds for ids minted by Identifier.ascending(), which
 * embed a timestamp, but not for sessions written by anything else — e.g. a
 * third-party importer emitting uuids. A single imported message whose id
 * happens to sort high then masquerades as the newest message, the run loop's
 * exit test (`lastUser.id < lastAssistant.id`) never passes, and opencode
 * re-requests until the provider rejects the assistant-terminated conversation.
 */
function msg(id: string, role: "user" | "assistant", created: number, finish?: string) {
  return {
    info: {
      id,
      sessionID: "ses_test",
      role,
      time: { created },
      ...(role === "assistant" ? { finish } : {}),
    },
    parts: [],
  } as unknown as MessageV2.WithParts
}

describe("MessageV2.latest ordering", () => {
  test("uses chronology, not raw id sort, to find the newest messages", () => {
    // An imported history whose ids do not sort chronologically: the FIRST
    // message carries the highest-sorting id.
    const msgs = [
      msg("msg_ffffffffffffffffffffffff", "assistant", 1_000, "stop"), // oldest, id sorts highest
      msg("msg_0000000000000000000000aa", "user", 2_000),
      msg("msg_0000000000000000000000bb", "assistant", 3_000, "stop"), // newest in time
    ]

    const { user, assistant } = MessageV2.latest(msgs)

    expect(user?.id).toBe("msg_0000000000000000000000aa")
    // Raw id sort would return the 1_000ms message here.
    expect(assistant?.id).toBe("msg_0000000000000000000000bb")
    expect(assistant?.time.created).toBe(3_000)
  })

  test("the newest assistant follows the newest user, so the run loop can exit", () => {
    const msgs = [
      msg("msg_ffffffffffffffffffffffff", "assistant", 1_000, "stop"),
      msg("msg_0000000000000000000000aa", "user", 2_000),
      msg("msg_0000000000000000000000bb", "assistant", 3_000, "stop"),
    ]

    const { user, assistant } = MessageV2.latest(msgs)

    // What runLoop asserts before breaking out of the loop.
    expect(user!.time.created).toBeLessThan(assistant!.time.created)
  })

  test("still orders correctly for natively minted, time-sortable ids", () => {
    const msgs = [
      msg("msg_f90250c84002aaaaaaaaaaaaaa", "user", 1_000),
      msg("msg_f90253552001bbbbbbbbbbbbbb", "assistant", 2_000, "stop"),
    ]

    const { user, assistant } = MessageV2.latest(msgs)

    expect(user?.id).toBe("msg_f90250c84002aaaaaaaaaaaaaa")
    expect(assistant?.id).toBe("msg_f90253552001bbbbbbbbbbbbbb")
  })

  test("ties on timestamp fall back to id order", () => {
    const msgs = [
      msg("msg_aaa", "assistant", 5_000, "stop"),
      msg("msg_bbb", "assistant", 5_000, "stop"),
    ]

    expect(MessageV2.latest(msgs).assistant?.id).toBe("msg_bbb")
  })
})
