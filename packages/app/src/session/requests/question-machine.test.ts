import { describe, expect, test } from "bun:test"
import type { FormInfo } from "@opencode/client/promise"
import {
  buildFormAnswer,
  createQuestionDockState,
  isQuestionBusy,
  questionDraft,
  questionSpecs,
  transitionQuestionDock,
  type QuestionDockEvent,
  type QuestionDockState,
  type QuestionDockTransition,
} from "./question-machine"
import { QUESTION_CACHE_LIMIT, questionCache } from "./question-state"

const form: FormInfo = {
  id: "frm_question",
  sessionID: "ses_question",
  title: "Questions",
  metadata: { kind: "question" },
  fields: [
    {
      key: "layout",
      type: "string",
      title: "Layout",
      description: "Which layout?",
      options: [
        { value: "focused", label: "Focused" },
        { value: "wide", label: "Wide" },
      ],
      custom: true,
    },
    {
      key: "include",
      type: "multiselect",
      title: "Include",
      description: "Which surfaces?",
      options: [
        { value: "files", label: "Changed files" },
        { value: "terminal", label: "Terminal" },
      ],
      custom: true,
    },
  ],
}

const questions = questionSpecs(form)

function replay(events: QuestionDockEvent[], from: QuestionDockState = createQuestionDockState(questions.length)) {
  return events.reduce<QuestionDockTransition[]>((steps, event) => {
    steps.push(transitionQuestionDock(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

function answering(events: QuestionDockEvent[]) {
  const state = replay(events).at(-1)!.state

  if (state.status !== "answering") throw new Error(`expected answering, got ${state.status}`)

  return state
}

const reply = (state: QuestionDockState): QuestionDockEvent => ({
  type: "send",
  action: { type: "reply", answer: buildFormAnswer(questions, state.status === "disposed" ? [] : state.drafts) },
})

describe("transitionQuestionDock", () => {
  test("keeps a picked option when the custom answer typed with its value is turned off or edited", () => {
    const typed = answering([
      { type: "tab.select", tab: 1 },
      { type: "option.pick", value: "files", multiple: true },
      { type: "custom.input", text: "files", multiple: true },
    ])

    expect(buildFormAnswer(questions, typed.drafts)).toEqual({ include: ["files"] })

    const off = transitionQuestionDock(typed, { type: "custom.deselect" }).state
    const edited = transitionQuestionDock(typed, { type: "custom.input", text: "files2", multiple: true }).state

    expect(questionDraft(off, 1).selected).toEqual(["files"])
    expect(buildFormAnswer(questions, off.status === "answering" ? off.drafts : [])).toEqual({ include: ["files"] })
    expect(buildFormAnswer(questions, edited.status === "answering" ? edited.drafts : [])).toEqual({
      include: ["files", "files2"],
    })
  })

  test("answers a single choice with the custom answer only while it is picked", () => {
    const custom = answering([
      { type: "option.pick", value: "wide", multiple: false },
      { type: "custom.input", text: "  Split view ", multiple: false },
    ])

    expect(questionDraft(custom, 0).selected).toEqual([])
    expect(buildFormAnswer(questions, custom.drafts)).toEqual({ layout: "Split view" })

    const picked = transitionQuestionDock(custom, { type: "option.pick", value: "focused", multiple: false }).state

    expect(questionDraft(picked, 0)).toEqual({
      selected: ["focused"],
      customText: "  Split view ",
      customSelected: false,
    })
    expect(buildFormAnswer(questions, picked.status === "answering" ? picked.drafts : [])).toEqual({
      layout: "focused",
    })
  })

  test("stays busy between the reply's response and the form leaving, and sends once", () => {
    const start = answering([{ type: "option.pick", value: "wide", multiple: false }])
    const sending = transitionQuestionDock(start, reply(start))

    expect(sending.state).toMatchObject({ status: "sending", attempt: 1 })
    expect(sending.effects).toEqual([
      { type: "cache.delete" },
      { type: "request.send", attempt: 1, action: { type: "reply", answer: { layout: "wide" } } },
      { type: "notify.submit" },
    ])
    expect(transitionQuestionDock(sending.state, { type: "send", action: { type: "dismiss" } }).effects).toEqual([])

    const replied = transitionQuestionDock(sending.state, { type: "request.succeeded", attempt: 1 })

    expect(replied.state.status).toBe("replied")
    expect(isQuestionBusy(replied.state)).toBe(true)
    expect(transitionQuestionDock(replied.state, reply(replied.state))).toEqual({ state: replied.state, effects: [] })
    expect(transitionQuestionDock(replied.state, { type: "send", action: { type: "dismiss" } }).effects).toEqual([])
  })

  test("never keeps the draft of a form that was sent or settled", () => {
    const start = answering([{ type: "option.pick", value: "wide", multiple: false }])
    const sending = transitionQuestionDock(start, { type: "send", action: { type: "dismiss" } }).state
    const replied = transitionQuestionDock(sending, { type: "request.succeeded", attempt: 1 }).state
    const away = transitionQuestionDock(sending, { type: "disposed" })

    expect(away.effects).toEqual([])
    expect(transitionQuestionDock(away.state, { type: "request.succeeded", attempt: 1 })).toEqual({
      state: { status: "disposed", attempt: 1, unsent: undefined },
      effects: [],
    })
    expect(transitionQuestionDock(replied, { type: "disposed" }).effects).toEqual([])

    const settled = transitionQuestionDock(start, { type: "resolved" })

    expect(settled.state.status).toBe("replied")
    expect(settled.effects).toEqual([{ type: "cache.delete" }])
    expect(transitionQuestionDock(settled.state, { type: "disposed" }).effects).toEqual([])
    expect(transitionQuestionDock(sending, { type: "resolved" }).effects).toEqual([
      { type: "request.abort" },
      { type: "cache.delete" },
    ])
  })

  test("saves an unanswered draft when the dock goes away and restores it", () => {
    const start = answering([
      { type: "option.pick", value: "wide", multiple: false },
      { type: "tab.select", tab: 1 },
      { type: "custom.input", text: "Diagnostics", multiple: true },
    ])

    const disposed = transitionQuestionDock(start, { type: "disposed" })

    expect(disposed.state).toEqual({ status: "disposed", attempt: 0, unsent: undefined })
    expect(disposed.effects).toEqual([{ type: "cache.save", snapshot: { tab: 1, drafts: start.drafts } }])

    const restored = createQuestionDockState(questions.length, { tab: 1, drafts: start.drafts })

    expect(restored).toEqual({ ...start, attempt: 0 })
    expect(transitionQuestionDock(disposed.state, { type: "resolved" }).state).toBe(disposed.state)
  })

  test("gives the dock back when a reply times out or fails, and ignores the late result", () => {
    const start = answering([
      { type: "tab.select", tab: 1 },
      { type: "option.pick", value: "terminal", multiple: true },
    ])

    const sending = transitionQuestionDock(start, reply(start)).state
    const timedOut = transitionQuestionDock(sending, { type: "request.timed-out", attempt: 1 })

    expect(timedOut.state).toEqual({ status: "answering", attempt: 1, tab: 1, drafts: start.drafts })
    expect(timedOut.effects).toEqual([{ type: "request.abort" }, { type: "toast.fail" }])
    expect(transitionQuestionDock(timedOut.state, { type: "request.succeeded", attempt: 1 }).state).toBe(timedOut.state)

    const failed = transitionQuestionDock(sending, { type: "request.failed", attempt: 1, error: "offline" })

    expect(failed.state.status).toBe("answering")
    expect(failed.effects).toEqual([{ type: "toast.fail", error: "offline" }])

    const retry = transitionQuestionDock(failed.state, reply(failed.state)).state

    expect(retry).toMatchObject({ status: "sending", attempt: 2 })
    expect(transitionQuestionDock(retry, { type: "request.failed", attempt: 1 }).state).toBe(retry)
    expect(transitionQuestionDock(retry, { type: "request.timed-out", attempt: 1 }).state).toBe(retry)
  })

  test("reports a reply that fails or hangs after the dock went away, and keeps its draft", () => {
    const start = answering([
      { type: "tab.select", tab: 1 },
      { type: "option.pick", value: "terminal", multiple: true },
    ])

    const sending = transitionQuestionDock(start, reply(start)).state
    const away = transitionQuestionDock(sending, { type: "disposed" }).state
    const snapshot = { tab: 1, drafts: start.drafts }

    expect(away).toEqual({ status: "disposed", attempt: 1, unsent: snapshot })

    const failed = transitionQuestionDock(away, { type: "request.failed", attempt: 1, error: "offline" })

    expect(failed).toEqual({
      state: { status: "disposed", attempt: 1, unsent: undefined },
      effects: [
        { type: "toast.fail", error: "offline" },
        { type: "cache.save", snapshot },
      ],
    })
    expect(transitionQuestionDock(failed.state, { type: "request.timed-out", attempt: 1 }).effects).toEqual([])
    expect(transitionQuestionDock(away, { type: "request.timed-out", attempt: 1 }).effects).toEqual([
      { type: "request.abort" },
      { type: "toast.fail" },
      { type: "cache.save", snapshot },
    ])
    expect(transitionQuestionDock(away, { type: "request.failed", attempt: 0 }).state).toBe(away)
    expect(transitionQuestionDock(away, { type: "resolved" })).toEqual({
      state: { status: "disposed", attempt: 1, unsent: undefined },
      effects: [{ type: "request.abort" }],
    })
    expect(transitionQuestionDock(away, { type: "disposed" }).state).toBe(away)
  })

  test("ignores edits and tab changes that do not apply", () => {
    const start = createQuestionDockState(questions.length)

    expect(transitionQuestionDock(start, { type: "tab.select", tab: 0 }).state).toBe(start)
    expect(transitionQuestionDock(start, { type: "tab.select", tab: 2 }).state).toBe(start)
    expect(transitionQuestionDock(start, { type: "custom.deselect" }).state).toBe(start)

    const picked = transitionQuestionDock(start, { type: "option.pick", value: "wide", multiple: false }).state

    expect(transitionQuestionDock(picked, { type: "option.pick", value: "wide", multiple: false }).state).toBe(picked)
  })
})

describe("questionCache", () => {
  test("drops the oldest draft past the limit and refreshes a draft written again", () => {
    const snapshot = { tab: 0, drafts: [] }
    Array.from({ length: QUESTION_CACHE_LIMIT }, (_, index) => questionCache.set(`cache-test:${index}`, snapshot))
    questionCache.set("cache-test:0", snapshot)
    questionCache.set("cache-test:extra", snapshot)

    expect(questionCache.get("cache-test:0")).toBe(snapshot)
    expect(questionCache.get("cache-test:1")).toBeUndefined()
    expect(questionCache.get("cache-test:extra")).toBe(snapshot)
  })
})
