import { afterEach, describe, expect, jest, test } from "bun:test"
import { createRoot } from "solid-js"
import { createMemoryComposerState } from "./state"
import {
  INITIAL_QUOTE_COMMENT_STATE,
  createQuoteCommentController,
  selectQuoteCommentKey,
  selectQuoteCommentView,
  transitionQuoteComment,
  type QuoteCommentEvent,
  type QuoteCommentState,
  type QuoteCommentTransition,
} from "./quote-comment-machine"

const key = "quote:c=1"

function replay(events: QuoteCommentEvent[], state: QuoteCommentState = INITIAL_QUOTE_COMMENT_STATE) {
  const initial: QuoteCommentTransition = { state, effects: [] }

  return events.reduce((result, event) => {
    const next = transitionQuoteComment(result.state, event)

    return { state: next.state, effects: [...result.effects, ...next.effects] }
  }, initial)
}

afterEach(() => {
  jest.useRealTimers()
})

describe("transitionQuoteComment", () => {
  test("closes the editor when its quote leaves the draft, so restoring the quote does not reopen it", () => {
    const result = replay([
      { type: "opened", key },
      { type: "retained", keys: ["file:a.ts"] },
    ])

    expect(result.state).toEqual({ status: "closed", issued: 0 })
    expect(selectQuoteCommentKey(result.state)).toBeUndefined()
    expect(replay([{ type: "retained", keys: [key] }], result.state).state).toBe(result.state)
  })

  test("a send that fails settles to failed and keeps the draft, and one that goes through closes", () => {
    const sending = replay([
      { type: "opened", key },
      { type: "send.requested", draft: "note" },
    ])

    expect(sending.state).toMatchObject({ status: "sending", attempt: 1, key, draft: "note" })
    expect(sending.effects).toEqual([{ type: "send.run", attempt: 1, key, draft: "note" }])

    const failed = transitionQuoteComment(sending.state, { type: "send.settled", attempt: 1, sent: false })

    expect(failed).toEqual({
      state: { status: "failed", issued: 1, key, draft: "note", anchor: undefined },
      effects: [],
    })
    expect(selectQuoteCommentView(failed.state, key, "")).toMatchObject({ draft: "note", failed: true })
    expect(transitionQuoteComment(sending.state, { type: "send.settled", attempt: 1, sent: true }).state).toEqual({
      status: "closed",
      issued: 1,
    })
  })

  test("ignores chip toggles, edits, a second send and a stale result while a send is in flight", () => {
    const sending = replay([
      { type: "opened", key },
      { type: "send.requested", draft: "note" },
    ]).state

    for (const event of [
      { type: "closed" },
      { type: "opened", key: "quote:c=2" },
      { type: "draft.changed", draft: "other" },
      { type: "send.requested", draft: "note" },
      { type: "send.settled", attempt: 0, sent: false },
    ] satisfies QuoteCommentEvent[])
      expect(transitionQuoteComment(sending, event)).toEqual({ state: sending, effects: [] })
  })

  test("ignores a late send result once the quote left, and an edit clears a failure", () => {
    const closed = replay([
      { type: "opened", key },
      { type: "send.requested", draft: "note" },
      { type: "retained", keys: [] },
    ])

    expect(transitionQuoteComment(closed.state, { type: "send.settled", attempt: 1, sent: false }).state).toBe(
      closed.state,
    )

    const failed = replay([
      { type: "opened", key },
      { type: "send.requested", draft: "note" },
      { type: "send.settled", attempt: 1, sent: false },
      { type: "draft.changed", draft: "fixed" },
    ])

    expect(failed.state).toEqual({ status: "open", issued: 1, key, draft: "fixed", anchor: undefined })
  })

  test("disposing during a send ignores its late result and later events", () => {
    const disposed = replay([{ type: "opened", key }, { type: "send.requested", draft: "note" }, { type: "disposed" }])

    expect(disposed.state).toEqual({ status: "disposed" })
    expect(transitionQuoteComment(disposed.state, { type: "send.settled", attempt: 1, sent: false }).state).toBe(
      disposed.state,
    )
    expect(transitionQuoteComment(disposed.state, { type: "opened", key }).state).toBe(disposed.state)
  })
})

describe("createQuoteCommentController", () => {
  test("a rejected send fails, and a slow one keeps sending until it goes through", async () => {
    jest.useFakeTimers()
    const controller = createQuoteCommentController()

    controller.set(key)
    controller.send("note", () => Promise.reject(new Error("offline")))
    expect(controller.state().status).toBe("sending")
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.state()).toMatchObject({ status: "failed", draft: "note" })

    // The request layer gives up on a silent server after a minute and the prompt send retries once, so a send that
    // the composer still runs must not show as failed: the user would retry it while the first one may still land.
    const slow = Promise.withResolvers<boolean>()
    controller.send("note", () => slow.promise)
    jest.advanceTimersByTime(5 * 60_000)
    expect(controller.state()).toMatchObject({ status: "sending", draft: "note" })
    slow.resolve(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.state()).toEqual({ status: "closed", issued: 2 })
  })

  test("removing a quote from the composer closes its editor and highlight before a failed send restores it", () => {
    createRoot((dispose) => {
      const composer = createMemoryComposerState()
      const quote = { type: "quote" as const, text: "passage", commentID: "1" }

      composer.context.add(quote)
      composer.quoteSource.add(key, [{ partID: "part", revealID: "message", start: 0, end: 7, text: "passage" }])
      composer.quoteComment.set(key)
      expect(composer.quoteSource.state.pending).toBe(key)

      composer.context.remove(key)
      composer.context.add(quote)
      expect(composer.quoteComment.key()).toBeUndefined()
      expect(composer.quoteSource.state.pending).toBeUndefined()
      dispose()
    })
  })
})
