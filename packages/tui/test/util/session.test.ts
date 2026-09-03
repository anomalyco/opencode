import { describe, expect, test } from "bun:test"
import { compareSessionsByTime, isDefaultTitle, nextUserMessageAfter } from "../../src/util/session"

// Message ids carry a 48-bit time prefix that wraps every ~795 days: after a
// wrap, fresh ids (msg_0000...) sort below older ones (msg_ff42...).
// Redo boundaries use array position.
const messages = [
  { id: "msg_ff423c83f001ibGzwcHELsDfop", role: "user" }, // pre-wrap, oldest
  { id: "msg_ff5ad131a001WhNqR6oX2N7KRS", role: "assistant" },
  { id: "msg_0000267f1001NBgzca5UNHQr7n", role: "user" }, // post-wrap revert point
  { id: "msg_000029787001DYbXAVN3eyKZBl", role: "assistant" },
  { id: "msg_000030605001m8cCZxYiweZ9n7", role: "user" }, // actual next user
] as const

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  test("nextUserMessageAfter picks the next user message by position", () => {
    // msg_ff42... sorts above all post-wrap ids, so id order and time order
    // diverge in this fixture.
    const naive = messages.find((x) => x.role === "user" && x.id > "msg_0000267f1001NBgzca5UNHQr7n")
    expect(naive?.id).toBe("msg_ff423c83f001ibGzwcHELsDfop")
    const next = nextUserMessageAfter(messages, "msg_0000267f1001NBgzca5UNHQr7n")
    expect(next?.id).toBe("msg_000030605001m8cCZxYiweZ9n7")
  })

  test("nextUserMessageAfter returns undefined when the revert point has no following user message", () => {
    expect(nextUserMessageAfter(messages, "msg_000030605001m8cCZxYiweZ9n7")).toBeUndefined()
  })

  test("nextUserMessageAfter returns undefined for an unknown message id", () => {
    expect(nextUserMessageAfter(messages, "msg_does-not-exist")).toBeUndefined()
  })

  test("compareSessionsByTime orders child sessions by updated time, not id", () => {
    // Session ids carry an inverted time prefix that wraps: a newer post-wrap session
    // (ses_ffff...) sorts after an older pre-wrap one (ses_000b...) by id.
    // Sessions are ordered by time.
    const older = { id: "ses_000b546a1ffeVEfro39BIgUSKd", time: { created: 1_000 } as { created: number; updated?: number } }
    const newer = { id: "ses_ffffb5fe2ffe3fyEdnrtQqBz28", time: { created: 2_000 } as { created: number; updated?: number } }

    const byId = [newer, older].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    expect(byId[0]?.id).toBe("ses_000b546a1ffeVEfro39BIgUSKd")

    const byTime = [newer, older].sort(compareSessionsByTime)
    expect(byTime.map((s) => s.id)).toEqual(["ses_ffffb5fe2ffe3fyEdnrtQqBz28", "ses_000b546a1ffeVEfro39BIgUSKd"])
  })
})
