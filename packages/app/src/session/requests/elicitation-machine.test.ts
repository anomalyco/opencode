import { describe, expect, test } from "bun:test"
import type { FormInfo } from "@opencode/client/promise"
import {
  buildElicitationAnswer,
  createElicitationDockState,
  isElicitationBusy,
  selectElicitationDraft,
  transitionElicitationDock,
  type ElicitationDockEvent,
  type ElicitationDockState,
  type ElicitationDockTransition,
} from "./elicitation-machine"

const fields: FormInfo["fields"] = [
  { key: "name", type: "string", title: "Name", default: "  Ada " },
  { key: "count", type: "integer", title: "Count" },
  { key: "ratio", type: "number", title: "Ratio" },
  { key: "notify", type: "boolean", title: "Notify" },
  {
    key: "areas",
    type: "multiselect",
    title: "Areas",
    options: [
      { value: "app", label: "App" },
      { value: "tui", label: "TUI" },
    ],
  },
  { key: "auth", type: "external", url: "https://example.com/authorize" },
]

const edits: ElicitationDockEvent[] = [
  { type: "text.set", key: "name", value: "Grace" },
  { type: "number.set", key: "count", value: "-" },
  { type: "number.set", key: "ratio", value: "0.5" },
  { type: "flag.set", key: "notify", value: true },
  { type: "list.toggle", key: "areas", value: "tui", checked: true },
]

const reply = { type: "reply", answer: { name: "Grace" } } as const

function replay(events: ElicitationDockEvent[], from: ElicitationDockState = createElicitationDockState(fields)) {
  return events.reduce<ElicitationDockTransition[]>((steps, event) => {
    steps.push(transitionElicitationDock(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

function last(events: ElicitationDockEvent[], from?: ElicitationDockState) {
  return replay(events, from).at(-1)!
}

describe("transitionElicitationDock", () => {
  // Two mutations used to run side by side, and the dock re-enabled as soon as the reply resolved.
  test("one send claims the dock, a second one is ignored and it stays busy after the reply lands", () => {
    const sending = last([{ type: "send", action: reply }])

    expect(sending.state).toMatchObject({ status: "sending", attempt: 1, action: reply })
    expect(sending.effects).toEqual([
      { type: "cache.delete" },
      { type: "request.send", attempt: 1, action: reply },
      { type: "notify.submit" },
    ])
    expect(isElicitationBusy(sending.state)).toBe(true)

    const again = transitionElicitationDock(sending.state, { type: "send", action: { type: "cancel" } })

    expect(again.state).toBe(sending.state)
    expect(again.effects).toEqual([])

    const replied = transitionElicitationDock(sending.state, { type: "request.succeeded", attempt: 1 })

    expect(replied.state.status).toBe("replied")
    expect(replied.effects).toEqual([{ type: "timeout.clear" }])
    expect(isElicitationBusy(replied.state)).toBe(true)
    ;[{ type: "send", action: reply } as const, { type: "send", action: { type: "cancel" } } as const].forEach(
      (event) => expect(transitionElicitationDock(replied.state, event).state).toBe(replied.state),
    )
  })

  // A hung request used to keep every control disabled.
  test("a request that never settles gives the dock back with the draft, and its late result is ignored", () => {
    const edited = last(edits).state

    const timedOut = last(
      [
        { type: "send", action: reply },
        { type: "request.timed-out", attempt: 1 },
      ],
      edited,
    )

    expect(timedOut.state).toEqual({ status: "answering", attempt: 1, draft: selectElicitationDraft(edited) })
    expect(timedOut.effects).toEqual([{ type: "timeout.clear" }, { type: "toast.fail", error: undefined }])

    const late = transitionElicitationDock(timedOut.state, { type: "request.failed", attempt: 1, error: "aborted" })

    expect(late.state).toBe(timedOut.state)
    expect(late.effects).toEqual([])

    const retry = transitionElicitationDock(timedOut.state, { type: "send", action: reply })

    expect(retry.state).toMatchObject({ status: "sending", attempt: 2 })
    expect(transitionElicitationDock(retry.state, { type: "request.succeeded", attempt: 1 }).state).toBe(retry.state)
  })

  test("a failed request reports its error and gives the dock back", () => {
    const failed = last([
      { type: "send", action: { type: "cancel" } },
      { type: "request.failed", attempt: 1, error: "offline" },
    ])

    expect(failed.state.status).toBe("answering")
    expect(failed.effects).toEqual([{ type: "timeout.clear" }, { type: "toast.fail", error: "offline" }])
  })

  // Unmounting the dock (a tab switch, a form resync) used to drop every typed answer.
  test("an unanswered dock keeps its draft for the next mount", () => {
    const edited = last(edits).state
    const disposed = transitionElicitationDock(edited, { type: "disposed" })
    const draft = selectElicitationDraft(edited)

    expect(disposed.state).toEqual({ status: "disposed", attempt: 0, unsent: undefined })
    expect(disposed.effects).toEqual([{ type: "cache.save", draft }])
    expect(createElicitationDockState(fields, draft)).toEqual({ status: "answering", attempt: 0, draft })
    expect(draft).toEqual({
      text: { name: "Grace" },
      number: { count: "-", ratio: "0.5" },
      flag: { notify: true },
      list: { areas: ["tui"] },
    })
  })

  test("a reply in flight when the dock unmounts keeps its draft until it settles", () => {
    const edited = last(edits).state
    const draft = selectElicitationDraft(edited)
    const disposed = last([{ type: "send", action: reply }, { type: "disposed" }], edited)

    expect(disposed).toEqual({ state: { status: "disposed", attempt: 1, unsent: draft }, effects: [] })

    const settled: ElicitationDockState = { status: "disposed", attempt: 1, unsent: undefined }

    expect(transitionElicitationDock(disposed.state, { type: "request.failed", attempt: 1, error: "offline" })).toEqual(
      {
        state: settled,
        effects: [{ type: "timeout.clear" }, { type: "toast.fail", error: "offline" }, { type: "cache.save", draft }],
      },
    )
    expect(transitionElicitationDock(disposed.state, { type: "request.timed-out", attempt: 1 })).toEqual({
      state: settled,
      effects: [{ type: "timeout.clear" }, { type: "toast.fail", error: undefined }, { type: "cache.save", draft }],
    })
    expect(transitionElicitationDock(disposed.state, { type: "request.succeeded", attempt: 1 })).toEqual({
      state: settled,
      effects: [{ type: "timeout.clear" }],
    })
    expect(transitionElicitationDock(disposed.state, { type: "resolved" })).toEqual({
      state: settled,
      effects: [{ type: "timeout.clear" }],
    })
    expect(transitionElicitationDock(disposed.state, { type: "request.failed", attempt: 0 }).state).toBe(disposed.state)
  })

  test("the form settling elsewhere closes the dock and drops its draft", () => {
    expect(last([{ type: "resolved" }])).toEqual({
      state: { status: "replied", attempt: 0, draft: selectElicitationDraft(createElicitationDockState(fields)) },
      effects: [{ type: "cache.delete" }],
    })
    expect(last([{ type: "send", action: reply }, { type: "resolved" }]).effects).toEqual([
      { type: "timeout.clear" },
      { type: "cache.delete" },
    ])

    const replied = last([{ type: "resolved" }]).state
    const settled: ElicitationDockState = { status: "disposed", attempt: 0, unsent: undefined }

    expect(transitionElicitationDock(replied, { type: "resolved" }).state).toBe(replied)
    expect(transitionElicitationDock(settled, { type: "resolved" }).state).toBe(settled)
  })

  test("an edit that changes nothing keeps the same state", () => {
    const state = createElicitationDockState(fields)

    const unchanged: ElicitationDockEvent[] = [
      { type: "text.set", key: "name", value: "  Ada " },
      { type: "number.set", key: "count", value: "" },
      { type: "flag.set", key: "notify", value: false },
      { type: "list.toggle", key: "areas", value: "app", checked: false },
    ]

    unchanged.forEach((event) => expect(transitionElicitationDock(state, event).state).toBe(state))
  })
})

test("buildElicitationAnswer", () => {
  const draft = selectElicitationDraft(
    last(
      [
        { type: "number.set", key: "count", value: " 3 " },
        { type: "list.toggle", key: "areas", value: "app", checked: true },
      ],
      createElicitationDockState([...fields, { key: "secret", type: "string", hidden: true, default: "x" }]),
    ).state,
  )

  expect(
    buildElicitationAnswer([...fields, { key: "secret", type: "string", hidden: true, default: "x" }], draft),
  ).toEqual({ name: "Ada", count: 3, notify: false, areas: ["app"], auth: true })
})
