import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import {
  createTimelineSyncState,
  DISPOSED_TIMELINE_SYNC_EVENT,
  isTimelineReady,
  isTimelineSyncing,
  LEADING_TURN_BUSY_LIMIT,
  leadingTurnNeedsParent,
  resolveLeadingAssistant,
  timelineSyncError,
  transitionTimelineSync,
  type TimelineSyncEffect,
  type TimelineSyncEvent,
  type TimelineSyncState,
} from "./sync-machine"

const user = (id: string): SessionMessageUser => ({ id, type: "user", text: id, time: { created: 1 } })

const assistant = (id: string): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  time: { created: 1 },
})

const target = { sessionKey: "dir/ses_1", sessionID: "ses_1" }

const other = { sessionKey: "dir/ses_2", sessionID: "ses_2" }

function syncing(state = createTimelineSyncState()) {
  return transitionTimelineSync(state, { type: "target.changed", target }).state
}

// Plays the machine against an in-memory transcript the way the model's driver does: every pause and page reads the
// transcript as it is when the timer or request settles.
function enrich(input: {
  memo: WeakMap<SessionMessageInfo[], string>
  messages: () => SessionMessageInfo[]
  more: () => boolean
  loadMore: () => boolean
  state?: TimelineSyncState
  // Stops after this many effects, as a tab switch would.
  interrupt?: (effect: TimelineSyncEffect) => boolean
}) {
  const calls: string[] = []
  let state = syncing(input.state)
  const messages = input.messages()
  const assistantID = resolveLeadingAssistant(input.memo, messages)

  let effects = dispatch({
    type: "sync.succeeded",
    attempt: state.attempt,
    assistantID,
    needsParent: !!assistantID && leadingTurnNeedsParent(messages, assistantID),
    more: input.more(),
  })

  function dispatch(event: TimelineSyncEvent) {
    const next = transitionTimelineSync(state, event)
    state = next.state

    return next.effects
  }

  const needsParent = (id: string) => leadingTurnNeedsParent(input.messages(), id)

  while (effects.length) {
    const effect = effects[0]!

    if (input.interrupt?.(effect)) return { calls, state }

    if (effect.type === "pause.start") {
      calls.push("pause")
      effects = dispatch({
        type: "enrich.paused",
        attempt: effect.attempt,
        needsParent: needsParent(effect.assistantID),
        more: input.more(),
        loading: false,
      })
      continue
    }

    if (effect.type !== "page.load") throw new Error(`Unexpected effect ${effect.type}`)
    calls.push("load")
    const succeeded = input.loadMore()
    effects = dispatch({
      type: "enrich.page-settled",
      attempt: effect.attempt,
      succeeded,
      needsParent: needsParent(effect.assistantID),
      more: input.more(),
    })
  }

  return { calls, state }
}

const loads = (calls: string[]) => calls.filter((call) => call === "load").length

describe("timeline sync", () => {
  test("bounds the wait for another history load instead of polling forever", () => {
    const loading = syncing()

    let { state, effects } = transitionTimelineSync(loading, {
      type: "sync.succeeded",
      attempt: loading.attempt,
      assistantID: "msg_latest",
      needsParent: true,
      more: true,
    })

    let pauses = 0

    // Another caller's page load never settles, so every pause finds history still loading.
    while (effects[0]?.type === "pause.start" && pauses < LEADING_TURN_BUSY_LIMIT * 2) {
      pauses += 1

      const next = transitionTimelineSync(state, {
        type: "enrich.paused",
        attempt: state.attempt,
        needsParent: true,
        more: true,
        loading: true,
      })

      state = next.state
      effects = next.effects
    }

    expect(pauses).toBe(LEADING_TURN_BUSY_LIMIT)
    expect(state.status).toBe("ready")
    expect(effects).toEqual([])
  })

  test("a failed first sync reports its error without throwing, and only for that session", () => {
    const error = new Error("sync failed")
    const loading = syncing()
    const failed = transitionTimelineSync(loading, { type: "sync.failed", attempt: loading.attempt, error }).state

    expect(timelineSyncError(failed, target)).toBe(error)
    expect(isTimelineSyncing(failed, target)).toBe(false)
    expect(isTimelineReady(failed, target, () => false)).toBe(false)

    // A new-session draft has no session.
    const draft = transitionTimelineSync(failed, { type: "target.changed", target: undefined })
    expect(draft.state.status).toBe("idle")
    expect(timelineSyncError(draft.state, undefined)).toBeUndefined()
    expect(isTimelineSyncing(draft.state, undefined)).toBe(false)
    expect(isTimelineReady(draft.state, undefined, () => false)).toBe(true)

    const switched = transitionTimelineSync(failed, { type: "target.changed", target: other })
    expect(timelineSyncError(switched.state, other)).toBeUndefined()
    expect(isTimelineSyncing(switched.state, other)).toBe(true)
    expect(switched.effects).toEqual([{ type: "sync.start", target: other, attempt: switched.state.attempt }])
  })

  test("a first sync that never settles reveals the timeline and ignores its late result", () => {
    const loading = syncing()
    expect(isTimelineReady(loading, target, () => false)).toBe(false)

    const timedOut = transitionTimelineSync(loading, { type: "sync.timed-out", attempt: loading.attempt })
    expect(timedOut.state.status).toBe("ready")
    expect(timedOut.effects).toEqual([{ type: "sync.cancel" }])
    expect(isTimelineReady(timedOut.state, target, () => false)).toBe(true)

    const late: TimelineSyncEvent[] = [
      { type: "sync.succeeded", attempt: loading.attempt, assistantID: "msg_1", needsParent: true, more: true },
      { type: "sync.failed", attempt: loading.attempt, error: new Error("late") },
    ]

    late.forEach((event) => expect(transitionTimelineSync(timedOut.state, event).state).toBe(timedOut.state))
  })

  test("background enrichment does not count as syncing", () => {
    const loading = syncing()
    expect(isTimelineSyncing(loading, target)).toBe(true)

    const pausing = transitionTimelineSync(loading, {
      type: "sync.succeeded",
      attempt: loading.attempt,
      assistantID: "msg_latest",
      needsParent: true,
      more: true,
    }).state

    expect(pausing).toMatchObject({ status: "enriching", step: "pausing" })
    expect(isTimelineSyncing(pausing, target)).toBe(false)

    const paging = transitionTimelineSync(pausing, {
      type: "enrich.paused",
      attempt: pausing.attempt,
      needsParent: true,
      more: true,
      loading: false,
    }).state

    expect(paging).toMatchObject({ status: "enriching", step: "loading" })
    expect(isTimelineSyncing(paging, target)).toBe(false)
    expect(isTimelineReady(paging, target, () => false)).toBe(true)
  })

  test("leaving the session cancels the step in flight, and disposal stops it", () => {
    const loading = syncing()
    expect(transitionTimelineSync(loading, DISPOSED_TIMELINE_SYNC_EVENT).effects).toEqual([{ type: "sync.cancel" }])

    const pausing = transitionTimelineSync(loading, {
      type: "sync.succeeded",
      attempt: loading.attempt,
      assistantID: "msg_latest",
      needsParent: true,
      more: true,
    }).state

    expect(transitionTimelineSync(pausing, { type: "target.changed", target: other }).effects).toEqual([
      { type: "pause.cancel" },
      { type: "sync.start", target: other, attempt: pausing.attempt + 1 },
    ])

    const paging = transitionTimelineSync(pausing, {
      type: "enrich.paused",
      attempt: pausing.attempt,
      needsParent: true,
      more: true,
      loading: false,
    }).state

    const disposed = transitionTimelineSync(paging, DISPOSED_TIMELINE_SYNC_EVENT)
    expect(disposed.state.status).toBe("idle")
    expect(disposed.effects).toEqual([{ type: "page.abort" }])

    const stale = transitionTimelineSync(disposed.state, {
      type: "enrich.page-settled",
      attempt: paging.attempt,
      succeeded: true,
      needsParent: true,
      more: true,
    })

    expect(stale.state).toBe(disposed.state)
    expect(transitionTimelineSync(disposed.state, DISPOSED_TIMELINE_SYNC_EVENT).state).toBe(disposed.state)
  })

  test("the same session keeps its sync", () => {
    const loading = syncing()
    const next = transitionTimelineSync(loading, { type: "target.changed", target: { ...target } })

    expect(next.state).toBe(loading)
    expect(next.effects).toEqual([])
  })

  test("does not enrich a different leading turn after prepending to a retained transcript", () => {
    const memo = new WeakMap<SessionMessageInfo[], string>()
    const messages: SessionMessageInfo[] = [user("msg_user"), assistant("msg_latest")]
    const input = { memo, messages: () => messages, more: () => true, loadMore: () => true }

    expect(loads(enrich(input).calls)).toBe(0)
    messages.unshift(assistant("msg_older"))
    expect(loads(enrich(input).calls)).toBe(0)

    // An evicted/reloaded transcript gets its own initial enrichment budget.
    const reloaded = [...messages]
    expect(loads(enrich({ ...input, messages: () => reloaded }).calls)).toBe(3)
  })

  const resumed = ["msg_previous_turn", "msg_parent", "msg_latest"]

  test("resumes the original leading turn after switching away", () => {
    const memo = new WeakMap<SessionMessageInfo[], string>()
    const messages: SessionMessageInfo[] = [assistant("msg_latest")]

    const input = {
      memo,
      messages: () => messages,
      more: () => true,
      loadMore: () => {
        messages.unshift(assistant("msg_previous_turn"), user("msg_parent"))

        return true
      },
    }

    // The tab switches away during the first pause.
    const away = enrich({ ...input, interrupt: (effect) => effect.type === "pause.start" })
    expect(loads(away.calls)).toBe(0)
    const left = transitionTimelineSync(away.state, { type: "target.changed", target: other }).state

    const back = enrich({ ...input, state: left })
    expect(messages.map((message) => message.id)).toEqual(resumed)
    expect(loads(back.calls)).toBe(1)
    expect(back.state.status).toBe("ready")

    expect(loads(enrich(input).calls)).toBe(0)
  })

  test("resumes the original leading turn after a failed page", () => {
    const memo = new WeakMap<SessionMessageInfo[], string>()
    const messages: SessionMessageInfo[] = [assistant("msg_latest")]
    let attempts = 0

    const input = {
      memo,
      messages: () => messages,
      more: () => true,
      loadMore: () => {
        attempts += 1

        if (attempts === 1) return false
        messages.unshift(assistant("msg_previous_turn"), user("msg_parent"))

        return true
      },
    }

    const failed = enrich(input)
    expect(failed.state.status).toBe("ready")
    expect(loads(failed.calls)).toBe(1)

    const retried = enrich(input)
    expect(messages.map((message) => message.id)).toEqual(resumed)
    expect(loads(retried.calls)).toBe(1)
    expect(loads(enrich(input).calls)).toBe(0)
  })

  test("resumes the original leading turn after the transcript reconnects", () => {
    const memo = new WeakMap<SessionMessageInfo[], string>()
    const messages: SessionMessageInfo[] = [assistant("msg_latest")]

    const input = {
      memo,
      messages: () => messages,
      more: () => true,
      loadMore: () => {
        messages.unshift(assistant("msg_previous_turn"), user("msg_parent"))

        return true
      },
    }

    expect(loads(enrich(input).calls)).toBe(1)
    messages.splice(0, messages.length, assistant("msg_latest"))
    expect(loads(enrich(input).calls)).toBe(1)
    expect(messages.map((message) => message.id)).toEqual(resumed)
    expect(loads(enrich(input).calls)).toBe(0)
  })

  test.each([
    ["caps background pages when the parent remains outside the window", [assistant("msg_latest")], 3],
    ["does not load before a leading user turn", [user("msg_user"), assistant("msg_latest")], 0],
    ["does not load without an assistant turn", [user("msg_user")], 0],
  ])("%s", (_name, messages: SessionMessageInfo[], expected) => {
    const result = enrich({
      memo: new WeakMap(),
      messages: () => messages,
      more: () => true,
      loadMore: () => true,
    })

    expect(loads(result.calls)).toBe(expected)
    expect(result.state.status).toBe("ready")
  })

  test("pauses between history pages and stops once the leading turn has its parent", () => {
    const pages: SessionMessageInfo[][] = [
      [assistant("msg_older")],
      [assistant("msg_previous_turn"), user("msg_parent")],
      [user("msg_earlier")],
    ]

    const messages: SessionMessageInfo[] = [assistant("msg_latest"), user("msg_next")]
    const calls: string[] = []

    const result = enrich({
      memo: new WeakMap(),
      messages: () => messages,
      more: () => pages.length > 0,
      loadMore: () => {
        const page = pages.shift()!
        messages.unshift(...page)
        calls.push(`load:${page[0]!.id}`)

        return true
      },
    })

    expect(result.calls).toEqual(["pause", "load", "pause", "load"])
    expect(calls).toEqual(["load:msg_older", "load:msg_previous_turn"])
    expect(pages).toHaveLength(1)
  })
})
