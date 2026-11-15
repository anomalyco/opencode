import { describe, expect, test } from "bun:test"
import {
  LINK_EXISTS_MAX_ENTRIES,
  LINK_EXISTS_NEGATIVE_TTL_MS,
  LINK_EXISTS_POSITIVE_TTL_MS,
  LINK_EXISTS_TIMEOUT_MS,
  createLinkExistsState,
  linkExistsAnswer,
  transitionLinkExists,
  type LinkExistsEvent,
  type LinkExistsState,
  type LinkExistsTransition,
} from "./link-exists-machine"

const requested = (key: string, now: number): LinkExistsEvent => ({ type: "check.requested", key, now })

const settled = (key: string, attempt: number, exists: boolean, now: number): LinkExistsEvent => ({
  type: "check.settled",
  key,
  attempt,
  exists,
  now,
})

const dropped = (key: string, attempt: number): LinkExistsEvent => ({ type: "check.dropped", key, attempt })

// Folds the events in order and returns the last transition.
const replay = (events: readonly LinkExistsEvent[], state: LinkExistsState = createLinkExistsState()) =>
  events.reduce<LinkExistsTransition>((last, event) => transitionLinkExists(last.state, event), { state, effects: [] })

describe("transitionLinkExists", () => {
  test("a recheck the user leaves keeps a known path a link, and the next read checks again", () => {
    const revalidating = replay([
      requested("k", 0),
      settled("k", 1, true, 10),
      requested("k", 10 + LINK_EXISTS_POSITIVE_TTL_MS),
    ])

    expect(revalidating.effects).toEqual([
      { type: "run-check", key: "k", attempt: 2, timeoutMs: LINK_EXISTS_TIMEOUT_MS },
    ])
    expect(linkExistsAnswer(revalidating.state, "k")).toEqual({ kind: "value", value: true })

    // The session switch cancels the recheck.
    const left = transitionLinkExists(revalidating.state, dropped("k", 2))

    expect(left.state.entries.get("k")).toEqual({ status: "stale" })
    expect(left.effects).toEqual([{ type: "abort-check", attempt: 2 }])
    expect(linkExistsAnswer(left.state, "k")).toEqual({ kind: "value", value: true })

    const back = transitionLinkExists(left.state, requested("k", 61_100))

    expect(back.state.entries.get("k")).toEqual({
      status: "revalidating",
      attempt: 3,
      deadline: 61_100 + LINK_EXISTS_TIMEOUT_MS,
    })
    expect(back.effects).toEqual([{ type: "run-check", key: "k", attempt: 3, timeoutMs: LINK_EXISTS_TIMEOUT_MS }])
    expect(linkExistsAnswer(back.state, "k")).toEqual({ kind: "value", value: true })
  })

  test("a hung first check is dropped at its timeout, so the next read checks again", () => {
    const checking = replay([requested("k", 0)])

    expect(checking.state.entries.get("k")).toEqual({
      status: "checking",
      attempt: 1,
      deadline: LINK_EXISTS_TIMEOUT_MS,
    })
    expect(linkExistsAnswer(checking.state, "k")).toEqual({ kind: "pending", attempt: 1 })

    const timedOut = transitionLinkExists(checking.state, dropped("k", 1))

    expect(timedOut.state.entries.has("k")).toBe(false)
    expect(timedOut.effects).toEqual([{ type: "abort-check", attempt: 1 }])
    expect(linkExistsAnswer(timedOut.state, "k")).toEqual({ kind: "value", value: false })
  })

  test("a read past the deadline replaces a hung check even when its timer never fired", () => {
    const result = replay([requested("k", 0), requested("k", LINK_EXISTS_TIMEOUT_MS)])

    expect(result.effects).toEqual([
      { type: "abort-check", attempt: 1 },
      { type: "run-check", key: "k", attempt: 2, timeoutMs: LINK_EXISTS_TIMEOUT_MS },
    ])
    expect(transitionLinkExists(result.state, settled("k", 1, true, 20_000)).state).toBe(result.state)
  })

  test("fresh answers and checks in flight answer from the cache without a new check", () => {
    const pending = replay([requested("k", 0)])

    expect(transitionLinkExists(pending.state, requested("k", LINK_EXISTS_TIMEOUT_MS - 1))).toEqual({
      state: pending.state,
      effects: [],
    })

    const found = transitionLinkExists(pending.state, settled("k", 1, true, 0))

    expect(found.state.entries.get("k")).toEqual({
      status: "settled",
      exists: true,
      expiresAt: LINK_EXISTS_POSITIVE_TTL_MS,
    })
    expect(transitionLinkExists(found.state, requested("k", LINK_EXISTS_POSITIVE_TTL_MS - 1)).state).toBe(found.state)

    const missing = transitionLinkExists(pending.state, settled("k", 1, false, 0))

    expect(transitionLinkExists(missing.state, requested("k", LINK_EXISTS_NEGATIVE_TTL_MS - 1)).state).toBe(
      missing.state,
    )
    expect(linkExistsAnswer(missing.state, "k")).toEqual({ kind: "value", value: false })

    const revalidating = transitionLinkExists(found.state, requested("k", LINK_EXISTS_POSITIVE_TTL_MS))

    expect(transitionLinkExists(revalidating.state, requested("k", LINK_EXISTS_POSITIVE_TTL_MS + 1)).state).toBe(
      revalidating.state,
    )
  })

  test("an expired negative waits for a fresh check", () => {
    const result = replay([requested("k", 0), settled("k", 1, false, 0), requested("k", LINK_EXISTS_NEGATIVE_TTL_MS)])

    expect(result.state.entries.get("k")).toMatchObject({ status: "checking", attempt: 2 })
    expect(linkExistsAnswer(result.state, "k")).toEqual({ kind: "pending", attempt: 2 })
  })

  test("a recheck that finds the path gone settles negative", () => {
    const result = replay([
      requested("k", 0),
      settled("k", 1, true, 0),
      requested("k", LINK_EXISTS_POSITIVE_TTL_MS),
      settled("k", 2, false, LINK_EXISTS_POSITIVE_TTL_MS),
    ])

    expect(linkExistsAnswer(result.state, "k")).toEqual({ kind: "value", value: false })
  })

  test("the oldest paths leave past the limit, ending their checks, and their late answers change nothing", () => {
    const full = replay(Array.from({ length: LINK_EXISTS_MAX_ENTRIES }, (_, index) => requested(`k${index}`, 0)))

    expect(full.state.entries.size).toBe(LINK_EXISTS_MAX_ENTRIES)

    const next = transitionLinkExists(full.state, requested("new", 0))

    expect(next.state.entries.size).toBe(LINK_EXISTS_MAX_ENTRIES)
    expect(next.state.entries.has("k0")).toBe(false)
    expect(next.effects).toEqual([
      { type: "abort-check", attempt: 1 },
      { type: "run-check", key: "new", attempt: LINK_EXISTS_MAX_ENTRIES + 1, timeoutMs: LINK_EXISTS_TIMEOUT_MS },
    ])
    expect(transitionLinkExists(next.state, settled("k0", 1, true, 0)).state).toBe(next.state)
  })

  test("answers for another attempt, or for a path with nothing in flight, change nothing", () => {
    const pending = replay([requested("k", 0)])

    expect(transitionLinkExists(pending.state, settled("k", 9, true, 0)).state).toBe(pending.state)
    expect(transitionLinkExists(pending.state, dropped("other", 1)).state).toBe(pending.state)

    const found = transitionLinkExists(pending.state, settled("k", 1, true, 0))

    expect(transitionLinkExists(found.state, dropped("k", 1))).toEqual({ state: found.state, effects: [] })
  })
})
