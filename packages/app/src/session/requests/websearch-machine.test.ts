import { describe, expect, test } from "bun:test"
import type { FormCreated, FormInfo } from "@opencode/client/promise"
import {
  createWebSearchState,
  selectWebSearchDockView,
  selectWebSearchView,
  transitionWebSearch,
  WEBSEARCH_REPLIED_LIMIT,
  type WebSearchEffect,
  type WebSearchEvent,
  type WebSearchState,
} from "./websearch-machine"

const consent: FormCreated["data"]["form"] = {
  id: "frm_consent",
  sessionID: "ses_child",
  title: "Web Search",
  metadata: { kind: "websearch.provider" },
  fields: [{ key: "choice", type: "string", required: true, custom: false }],
}

const options = [
  { value: "exa", label: "Exa" },
  { value: "parallel", label: "Parallel" },
]

const provider: FormCreated["data"]["form"] = {
  ...consent,
  id: "frm_provider",
  fields: [{ key: "provider", type: "string", options, required: true, custom: false }],
}

function providerForm(id: string, list = options): FormInfo {
  return {
    ...provider,
    id,
    fields: [{ key: "provider", type: "string", options: list, required: true, custom: false }],
  }
}

function play(events: WebSearchEvent[], state = createWebSearchState(true)) {
  const start: { state: WebSearchState; effects: readonly WebSearchEffect[]; all: readonly WebSearchEffect[] } = {
    state,
    effects: [],
    all: [],
  }

  return events.reduce((result, event) => {
    const next = transitionWebSearch(result.state, event)

    return { state: next.state, effects: next.effects, all: [...result.all, ...next.effects] }
  }, start)
}

function attempt(state: WebSearchState) {
  return state.status === "disposed" ? -1 : state.attempt
}

// The consent form is shown with its providers loaded.
function ready() {
  const shown = play([{ type: "request.changed", form: consent }])

  return play([{ type: "providers.loaded", attempt: attempt(shown.state), options }], shown.state).state
}

function dock(state: WebSearchState, hasSelection = true) {
  const view = selectWebSearchView(state)

  return selectWebSearchDockView({ ...view, connected: true, hasSelection })
}

function replies(effects: readonly WebSearchEffect[]) {
  return effects.flatMap((effect) => (effect.type === "reply.send" ? [[effect.formID, effect.answer]] : []))
}

// Starts `choose` for `selection` on the loaded consent form.
function choose(selection = "parallel") {
  return play([{ type: "submit", selection }], ready()).state
}

function settled(state: WebSearchState, type: "reply.succeeded" | "reply.already-settled" = "reply.succeeded") {
  if (state.status !== "responding") throw new Error(`expected responding, got ${state.status}`)

  return {
    type,
    attempt: state.attempt,
    formID: state.form.id,
    kind: state.step.type === "choosing" ? "choose" : "final",
  } as const
}

describe("websearch machine bug replays", () => {
  test("a dropped consent form no longer pins the dock after the handoff times out", () => {
    const chosen = choose()
    const waiting = play([{ type: "request.changed", form: undefined }, settled(chosen)], chosen)
    expect(waiting.state).toMatchObject({ status: "responding", step: { type: "awaiting-provider" } })
    expect(waiting.effects).toEqual([{ type: "handoff.wait", attempt: attempt(waiting.state), timeoutMs: 10_000 }])

    const timedOut = play([{ type: "handoff.timed-out", attempt: attempt(waiting.state) }], waiting.state)
    expect(timedOut.state.status).toBe("inactive")
    expect(timedOut.effects).toEqual([{ type: "respond.finish" }])
    expect(selectWebSearchView(timedOut.state)).toMatchObject({ request: undefined, sending: false })
  })

  test("a provider form that arrives only through a form sync is answered", () => {
    const chosen = choose()

    const result = play(
      [{ type: "request.changed", form: undefined }, settled(chosen), { type: "request.changed", form: provider }],
      chosen,
    )

    expect(result.state).toMatchObject({ status: "responding", form: provider, step: { type: "replying" } })
    expect(replies(result.effects)).toEqual([[provider.id, { provider: "parallel" }]])
  })

  test("a provider form that arrives through a sync before `choose` returns is answered once it does", () => {
    const chosen = choose()
    const early = play([{ type: "request.changed", form: provider }], chosen)
    expect(early.effects).toEqual([])
    const result = play([settled(chosen)], early.state)
    expect(replies(result.effects)).toEqual([[provider.id, { provider: "parallel" }]])
  })

  test("a provider list that never answers ends in load-failed and ignores the late answer", () => {
    const shown = play([{ type: "request.changed", form: consent }])
    expect(shown.effects).toEqual([{ type: "providers.load", attempt: 1, sessionID: "ses_child", timeoutMs: 15_000 }])
    const failed = play([{ type: "providers.timed-out", attempt: 1 }], shown.state)
    expect(failed.state.status).toBe("load-failed")
    expect(transitionWebSearch(failed.state, { type: "providers.loaded", attempt: 1, options }).state).toBe(
      failed.state,
    )
  })

  test("a reply that never answers ends in submit-failed", () => {
    const sending = play([{ type: "submit", selection: "random" }], ready())
    const result = play([{ type: "reply.timed-out", attempt: attempt(sending.state) }], sending.state)
    expect(result.state).toMatchObject({ status: "idle", form: consent, notice: "submit-failed" })
    expect(result.effects).toEqual([{ type: "respond.finish" }])
  })

  test("a provider form without the chosen option says so instead of stopping silently", () => {
    const chosen = play(
      [
        { type: "select", value: "parallel" },
        { type: "submit", selection: "parallel" },
      ],
      ready(),
    )

    const narrowed = providerForm("frm_narrow", [options[0]!])
    const result = play([settled(chosen.state), { type: "form.created", form: narrowed }], chosen.state)
    expect(result.state).toMatchObject({
      status: "idle",
      form: narrowed,
      selected: "exa",
      notice: "option-unavailable",
    })
    expect(result.effects).toEqual([{ type: "respond.finish" }])
    expect(replies(result.all)).toEqual([])
    expect(selectWebSearchView(result.state).optionUnavailable).toBe(true)
    expect(dock(result.state).status).toBe("unavailable")

    const empty = play(
      [settled(chosen.state), { type: "form.created", form: providerForm("frm_empty", []) }],
      chosen.state,
    )

    expect(dock(empty.state).status).toBe("empty")

    const picked = play([{ type: "select", value: "exa" }], result.state)
    expect(picked.state).toMatchObject({ notice: undefined, selected: "exa" })
  })

  test("the handoff keeps the provider options and shows no status while the consent form is gone", () => {
    const chosen = choose()
    const result = play([{ type: "request.changed", form: undefined }, settled(chosen)], chosen)

    expect(selectWebSearchView(result.state)).toMatchObject({ request: consent, options, selected: "parallel" })
    expect(dock(result.state).status).toBeUndefined()
  })

  test("a closing dock keeps its last controls inert", () => {
    const shown = play([
      { type: "request.changed", form: provider },
      { type: "select", value: "parallel" },
    ])

    const sending = play([{ type: "submit", selection: "parallel" }], shown.state)
    const closed = play([{ type: "request.changed", form: undefined }, settled(sending.state)], sending.state)
    expect(closed.state.status).toBe("inactive")
    expect(selectWebSearchView(closed.state)).toMatchObject({ specific: true, options, selected: "parallel" })
    expect(dock(closed.state)).toMatchObject({ busy: true, showDisable: false, status: undefined })
  })

  test("a form another client already settled closes without an error and without a handoff", () => {
    const sending = play([{ type: "submit", selection: "random" }], ready())
    const single = play([settled(sending.state, "reply.already-settled")], sending.state)
    expect(single.state.status).toBe("inactive")
    expect(selectWebSearchView(single.state).failed).toBe(false)

    const chosen = choose()
    const handoff = play([settled(chosen, "reply.already-settled")], chosen)
    expect(handoff.state.status).toBe("inactive")
    expect(handoff.effects).toEqual([{ type: "respond.finish" }])
  })

  test("an answered form does not come back from a stale form list", () => {
    const sending = play([{ type: "submit", selection: "random" }], ready())
    const answered = play([settled(sending.state)], sending.state)
    // The store still lists the form when the reply returns, then a stale sync writes it back.
    expect(answered.state.status).toBe("inactive")
    const stale = transitionWebSearch(answered.state, { type: "request.changed", form: { ...consent } })
    expect(stale.state.status).toBe("inactive")
    expect(stale.effects).toEqual([])
  })

  test("answered form IDs are bounded, oldest first", () => {
    const state = Array.from({ length: WEBSEARCH_REPLIED_LIMIT + 5 }, (_, index) =>
      providerForm(`frm_${index}`),
    ).reduce((current, form) => {
      const shown = transitionWebSearch(current, { type: "request.changed", form }).state
      const sending = transitionWebSearch(shown, { type: "submit", selection: "exa" }).state

      return transitionWebSearch(sending, settled(sending)).state
    }, createWebSearchState(true))

    if (state.status === "disposed") throw new Error("disposed")
    expect(state.replied).toHaveLength(WEBSEARCH_REPLIED_LIMIT)
    expect(state.replied[0]).toBe("frm_5")
  })

  test("a failure on one provider form does not carry over to the next", () => {
    const first = providerForm("frm_provider_1")

    const sending = play([
      { type: "request.changed", form: first },
      { type: "submit", selection: "exa" },
    ])

    const failed = play([{ type: "reply.failed", attempt: attempt(sending.state) }], sending.state)
    expect(failed.state).toMatchObject({ status: "idle", notice: "submit-failed" })
    const next = play([{ type: "request.changed", form: providerForm("frm_provider_2") }], failed.state)
    expect(next.state).toMatchObject({ status: "idle", notice: undefined })
  })

  test("a failed decline after a failed provider load shows the save error and keeps Retry", () => {
    const shown = play([{ type: "request.changed", form: consent }])

    const failed = play(
      [
        { type: "providers.failed", attempt: 1 },
        { type: "submit", selection: false },
      ],
      shown.state,
    )

    expect(replies(failed.effects)).toEqual([[consent.id, { choice: "disable" }]])
    const result = play([{ type: "reply.failed", attempt: attempt(failed.state) }], failed.state)
    expect(result.state).toMatchObject({ status: "load-failed", submitFailed: true })
    expect(dock(result.state)).toMatchObject({ status: "failed", showRetry: true })
  })
})

describe("websearch machine handshake", () => {
  test.each([
    ["random", "allow"],
    [false, "disable"],
  ] as const)("submits %s without a second form", (selection, choice) => {
    const sending = play([{ type: "submit", selection }], ready())
    expect(sending.effects.map((effect) => effect.type)).toEqual(["respond.start", "reply.send"])
    expect(sending.effects[1]).toMatchObject({ formID: consent.id, answer: { choice }, kind: "final" })
    const done = play([settled(sending.state)], sending.state)
    expect(done.effects).toEqual([{ type: "respond.finish" }])
  })

  test("subscribes before `choose` and keeps the handoff through the server's echo", () => {
    const sending = play([{ type: "submit", selection: "parallel" }], ready())
    expect(sending.effects.map((effect) => effect.type)).toEqual(["respond.start", "reply.send"])

    const echoed = play(
      [
        { type: "form.created", form: provider },
        { type: "form.replied", id: consent.id, answer: { choice: "choose" } },
      ],
      sending.state,
    )

    expect(echoed.state).toMatchObject({ status: "responding", step: { type: "choosing", providerForm: provider } })

    const result = play([settled(sending.state)], echoed.state)
    expect(replies(result.effects)).toEqual([[provider.id, { provider: "parallel" }]])
    const done = play([settled(result.state)], result.state)
    expect(done.state.status).toBe("inactive")
    expect(done.effects).toEqual([{ type: "respond.finish" }])
  })

  test("ignores questions, other sessions, and repeated consent forms during the handoff", () => {
    const chosen = choose()

    for (const form of [
      { ...provider, sessionID: "ses_other" },
      { ...provider, metadata: { kind: "question" } },
      consent,
    ]) {
      const result = transitionWebSearch(chosen, { type: "form.created", form })
      expect(result.state).toBe(chosen)
      expect(result.effects).toEqual([])
    }
  })

  test("a direct provider form needs no provider list and cannot be declined", () => {
    const shown = play([{ type: "request.changed", form: provider }])
    expect(shown.effects).toEqual([])
    expect(shown.state).toMatchObject({ status: "idle", options, selected: "exa" })
    expect(transitionWebSearch(shown.state, { type: "submit", selection: false }).state).toBe(shown.state)
    expect(replies(play([{ type: "submit", selection: "exa" }], shown.state).effects)).toEqual([
      [provider.id, { provider: "exa" }],
    ])
  })

  test("duplicate submits and unknown providers are ignored", () => {
    const sending = choose()
    expect(transitionWebSearch(sending, { type: "submit", selection: "parallel" }).state).toBe(sending)
    expect(transitionWebSearch(ready(), { type: "submit", selection: "removed" }).effects).toEqual([])
    expect(
      transitionWebSearch(play([{ type: "request.changed", form: consent }]).state, {
        type: "submit",
        selection: "random",
      }).effects,
    ).toEqual([])
  })

  test("does not submit while disconnected", () => {
    const offline = play([{ type: "connection.changed", connected: false }], ready()).state
    expect(transitionWebSearch(offline, { type: "submit", selection: "random" }).state).toBe(offline)
  })

  test.each<[string, WebSearchEvent]>([
    ["cancel", { type: "form.cancelled", id: consent.id }],
    ["other client", { type: "form.replied", id: consent.id, answer: { choice: "disable" } }],
    ["navigate", { type: "owner.changed" }],
    ["disconnect", { type: "connection.changed", connected: false }],
    ["dispose", { type: "disposed" }],
  ])("ends a pending handoff on %s", (_, event) => {
    const chosen = choose()
    const waiting = play([{ type: "request.changed", form: undefined }, settled(chosen)], chosen).state
    const result = transitionWebSearch(waiting, event)
    expect(result.effects).toContainEqual({ type: "respond.finish" })
    expect(selectWebSearchView(result.state)).toMatchObject({ request: undefined, sending: false })
    expect(transitionWebSearch(result.state, { type: "form.created", form: provider }).effects).toEqual([])
  })

  test("a disconnect keeps the loaded providers of a form that is still shown", () => {
    const sending = choose()
    const result = transitionWebSearch(sending, { type: "connection.changed", connected: false })
    expect(result.state).toMatchObject({
      status: "idle",
      form: consent,
      options,
      selected: "random",
      notice: undefined,
    })
    expect(result.effects).toEqual([{ type: "respond.finish" }])
  })

  test.each(["choose", "provider"] as const)("a failed %s reply shows the error and finishes", (failing) => {
    const chosen = choose()

    const state =
      failing === "choose"
        ? chosen
        : play(
            [settled(chosen), { type: "form.created", form: provider }, { type: "request.changed", form: provider }],
            chosen,
          ).state

    const result = transitionWebSearch(state, { type: "reply.failed", attempt: attempt(state) })
    expect(result.state).toMatchObject({
      status: "idle",
      form: failing === "choose" ? consent : provider,
      selected: "parallel",
      notice: "submit-failed",
    })
    expect(result.effects).toEqual([{ type: "respond.finish" }])
  })

  test("stale results are ignored", () => {
    const chosen = choose()
    const waiting = play([settled(chosen)], chosen).state
    expect(transitionWebSearch(waiting, { type: "reply.failed", attempt: attempt(chosen) }).state).toBe(waiting)
    expect(transitionWebSearch(waiting, { type: "reply.timed-out", attempt: attempt(chosen) }).state).toBe(waiting)
    expect(transitionWebSearch(waiting, { type: "handoff.timed-out", attempt: attempt(chosen) }).state).toBe(waiting)
    const shown = play([{ type: "request.changed", form: consent }]).state
    const reloaded = play([{ type: "retry" }], play([{ type: "providers.failed", attempt: 1 }], shown).state).state
    expect(transitionWebSearch(reloaded, { type: "providers.loaded", attempt: 1, options }).state).toBe(reloaded)
  })

  test("a reply that lands after its timeout still closes the form", () => {
    const sending = play([{ type: "submit", selection: "random" }], ready()).state
    const failed = transitionWebSearch(sending, { type: "reply.timed-out", attempt: attempt(sending) }).state
    const late = transitionWebSearch(failed, settled(sending))
    expect(late.state.status).toBe("inactive")
  })

  test("a new consent form starts over with a fresh provider list", () => {
    const next = { ...consent, id: "frm_consent_2" }
    const result = play(
      [
        { type: "select", value: "exa" },
        { type: "request.changed", form: next },
      ],
      ready(),
    )

    expect(result.state).toMatchObject({ status: "loading", form: next })
    expect(result.effects).toEqual([
      { type: "providers.load", attempt: attempt(result.state), sessionID: "ses_child", timeoutMs: 15_000 },
    ])
  })

  test("disposing ignores everything after", () => {
    const disposed = transitionWebSearch(ready(), { type: "disposed" }).state
    expect(transitionWebSearch(disposed, { type: "request.changed", form: consent }).state).toBe(disposed)
  })
})
