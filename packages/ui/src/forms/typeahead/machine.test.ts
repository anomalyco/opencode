import { describe, expect, test } from "bun:test"
import {
  createTypeaheadState,
  selectTypeaheadFailed,
  selectTypeaheadItems,
  selectTypeaheadPending,
  selectTypeaheadStale,
  transitionTypeahead,
  type TypeaheadEvent,
  type TypeaheadInitial,
  type TypeaheadState,
  type TypeaheadTransition,
} from "./machine"

const match = (item: string, query: string) => item.includes(query)

const type = (input: string, delayMs = 100): TypeaheadEvent<string> => ({
  type: "input.changed",
  input,
  delayMs,
  match,
})

function run(start: TypeaheadTransition<string> | TypeaheadState<string>, ...events: TypeaheadEvent<string>[]) {
  const initial = "state" in start ? start : { state: start, effects: [] }

  return events.reduce<TypeaheadTransition<string>>(
    (result, event) => transitionTypeahead(result.state, event),
    initial,
  )
}

const mount = (initial?: TypeaheadInitial<string>) => createTypeaheadState(initial)

describe("typeahead machine", () => {
  test("clearing the query back to the opening list shows it without a request", () => {
    const cleared = run(mount({ items: ["dev", "main"] }), type("rel"), type(""))

    expect(selectTypeaheadItems(cleared.state)).toEqual(["dev", "main"])
    expect(selectTypeaheadPending(cleared.state)).toBe(false)
    // Only the pending debounce is cancelled; nothing asks the source for the empty query.
    expect(cleared.effects).toEqual([{ type: "cancel" }])
  })

  test("retrying a failed opening list shows the rows it returns", () => {
    const opened = mount({ items: [], failed: true })

    expect(selectTypeaheadFailed(opened.state)).toBe(true)

    const retried = run(opened, { type: "retry.requested" })

    expect(retried.effects).toEqual([{ type: "request", attempt: 1, query: "" }])

    const answered = run(retried, { type: "request.succeeded", attempt: 1, items: ["dev"] })

    expect(selectTypeaheadFailed(answered.state)).toBe(false)
    expect(selectTypeaheadItems(answered.state)).toEqual(["dev"])
  })

  test("typing during a request cancels it and stops loading until the new query is sent", () => {
    const loading = run(mount({ items: ["dev"] }), type("a"), { type: "debounce.elapsed", attempt: 1 })

    expect(loading.state.status).toBe("loading")

    const retyped = run(loading, type("ab"))

    expect(retyped.state).toMatchObject({ status: "debouncing", attempt: 2 })
    expect(retyped.effects).toEqual([{ type: "debounce", attempt: 2, delayMs: 100 }])
    // The superseded request's late answer is ignored.
    expect(run(retyped, { type: "request.succeeded", attempt: 1, items: ["a"] }).state).toBe(retyped.state)
  })

  test("a failed query does not offer retry for the next query", () => {
    const failed = run(
      mount({ items: ["dev"] }),
      type("foo"),
      { type: "debounce.elapsed", attempt: 1 },
      { type: "request.failed", attempt: 1 },
    )

    expect(selectTypeaheadFailed(failed.state)).toBe(true)
    expect(selectTypeaheadFailed(run(failed, type("foobar")).state)).toBe(false)
  })

  test("a request that never answers fails after the timeout and cancels the request", () => {
    const timedOut = run(mount({ items: [] }), type("x", 0), { type: "request.timed-out", attempt: 1 })

    expect(selectTypeaheadFailed(timedOut.state)).toBe(true)
    expect(timedOut.effects).toEqual([{ type: "cancel" }])
  })

  test("pending queries narrow the rows on screen, and keep them dimmed when nothing matches", () => {
    const narrowed = run(mount({ items: ["dev", "release/base"] }), type("rel"))

    expect(selectTypeaheadItems(narrowed.state)).toEqual(["release/base"])
    expect(selectTypeaheadStale(narrowed.state)).toBe(false)

    const unmatched = run(narrowed, type("zzz"))

    expect(selectTypeaheadItems(unmatched.state)).toEqual(["release/base"])
    expect(selectTypeaheadStale(unmatched.state)).toBe(true)
  })

  test("a cached query answers at once", () => {
    const cached = run(
      mount({ items: ["dev"] }),
      type("rel"),
      { type: "debounce.elapsed", attempt: 1 },
      { type: "request.succeeded", attempt: 1, items: ["release"] },
      type("main"),
      type("rel"),
    )

    expect(cached.state.status).toBe("ready")
    expect(selectTypeaheadItems(cached.state)).toEqual(["release"])
    expect(cached.effects).toEqual([{ type: "cancel" }])
  })

  test("without an opening list the empty query is requested on mount", () => {
    const opened = mount()

    expect(opened.effects).toEqual([{ type: "request", attempt: 1, query: "" }])
    expect(selectTypeaheadPending(opened.state)).toBe(true)
  })

  test("a refreshed opening list replaces the shown rows for the empty query", () => {
    const refreshed = run(
      mount({ items: [], failed: true }),
      { type: "retry.requested" },
      { type: "request.succeeded", attempt: 1, items: ["dev"] },
      { type: "initial.synced", initial: { items: ["dev", "main"] } },
    )

    expect(selectTypeaheadItems(refreshed.state)).toEqual(["dev", "main"])
  })

  test("disposing cancels pending work and ignores later results", () => {
    const disposed = run(mount(), { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "cancel" }])
    expect(run(disposed, { type: "request.succeeded", attempt: 1, items: ["dev"] }).state).toBe(disposed.state)
  })
})
