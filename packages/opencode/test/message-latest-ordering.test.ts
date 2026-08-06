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

  test("survives compaction: array is reordered and messages are rewritten with new ids", () => {
    // filterCompacted emits [compaction-user, summary, ...retained tail..., continue-user],
    // so array position is NOT chronological, and compaction mints fresh ids for the
    // rewritten messages. latest() must therefore resolve by time (id as tiebreaker only),
    // never by array position: the OLD retained-tail assistant appears LATER in the array
    // than the newer summary, and must not be mistaken for the most recent turn.
    const msgs = [
      msg("msg_rewrite_compactionuser", "user", 9_000), // compaction user, placed FIRST
      msg("msg_rewrite_summary", "assistant", 9_001, "stop"), // summary (newest finished assistant)
      msg("msg_retained_user", "user", 1_000), // retained tail, OLD, appears mid-array
      msg("msg_retained_assistant", "assistant", 1_001, "stop"), // retained tail assistant, OLD
      msg("msg_rewrite_continueuser", "user", 9_002), // continue user, newest overall
    ]

    const { user, assistant, finished } = MessageV2.latest(msgs)

    // newest user is the continue-user, not the mid-array retained-tail user
    expect(user?.id).toBe("msg_rewrite_continueuser")
    // newest assistant is the summary, despite the older retained assistant sorting later
    // in the array (position) — selection is by time, not index
    expect(assistant?.id).toBe("msg_rewrite_summary")
    expect(finished?.id).toBe("msg_rewrite_summary")
  })
})
