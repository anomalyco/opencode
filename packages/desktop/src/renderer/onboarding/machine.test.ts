import { describe, expect, test } from "bun:test"
import {
  createOnboardingState,
  selectOnboardingWaiting,
  transitionOnboarding,
  type OnboardingEffect,
  type OnboardingEvent,
  type OnboardingState,
} from "./machine"

type Tab = { readonly draftID: string }

const tab: Tab = { draftID: "draft" }

const directory = "/Users/me/Documents/OpenCode"

const error = new Error("timed out")

// Folds events through the machine and keeps the effects of each step.
function replay(events: readonly OnboardingEvent<Tab>[], from: OnboardingState = createOnboardingState(true)) {
  return events.reduce<{ state: OnboardingState; effects: (readonly OnboardingEffect<Tab>[])[] }>(
    (result, event) => {
      const next = transitionOnboarding(result.state, event)

      return { state: next.state, effects: [...result.effects, next.effects] }
    },
    { state: from, effects: [] },
  )
}

// A fresh install on Home: main creates the default project.
const finished: OnboardingEvent<Tab>[] = [
  { type: "tabs.hydrated", shouldTrigger: true },
  { type: "finish.succeeded", directory },
]

describe("first-launch onboarding", () => {
  test("adds the default project and opens a draft in it behind the splash", () => {
    const run = replay([
      ...finished,
      { type: "seed.succeeded", revealed: false, canOpenDraft: true },
      { type: "draft.succeeded", tab, revealed: false },
    ])

    expect(run.effects).toEqual([
      [{ type: "finish-onboarding", shouldTrigger: true }],
      [{ type: "seed-project", directory }],
      [{ type: "open-draft", directory }],
      [{ type: "select-draft", tab }, { type: "notify-settled" }],
    ])
    expect(run.state.status).toBe("done")
  })

  test("settles without a project when the window does not trigger onboarding", () => {
    const run = replay([
      { type: "tabs.hydrated", shouldTrigger: false },
      { type: "finish.succeeded", directory: null },
    ])

    expect(run.effects.at(-1)).toEqual([{ type: "notify-settled" }])
    expect(selectOnboardingWaiting(createOnboardingState(false))).toBe(false)
  })

  test.each([
    ["the app shows while the project is added", [{ type: "seed.succeeded", revealed: true, canOpenDraft: true }]],
    [
      "a deep link opens a tab while the project is added",
      [{ type: "seed.succeeded", revealed: false, canOpenDraft: false }],
    ],
    [
      "the app shows while the draft opens",
      [
        { type: "seed.succeeded", revealed: false, canOpenDraft: true },
        { type: "draft.succeeded", tab, revealed: true },
      ],
    ],
  ] satisfies [string, OnboardingEvent<Tab>[]][])("does not navigate when %s", (_name, events) => {
    // On dev the run opened and selected the draft whenever it finished, taking the user away from what they opened.
    const run = replay([...finished, ...events])

    expect(run.effects.at(-1)).toEqual([{ type: "notify-settled" }])
    expect(run.state.status).toBe("done")
  })

  test.each([
    ["main fails to finish", [{ type: "tabs.hydrated", shouldTrigger: true }], "finish.failed"],
    ["adding the project fails", finished, "seed.failed"],
    [
      "opening the draft fails",
      [...finished, { type: "seed.succeeded", revealed: false, canOpenDraft: true }],
      "draft.failed",
    ],
  ] satisfies [string, OnboardingEvent<Tab>[], "finish.failed" | "seed.failed" | "draft.failed"][])(
    "shows the error page before the app shows, and a toast after, when %s",
    (_name, events, type) => {
      const before = replay(events).state

      // On dev a failure after the hydration timeout showed the app replaced the working window with the error page.
      expect(transitionOnboarding(before, { type, error, revealed: false }).effects).toEqual([
        { type: "fail-startup", error },
      ])
      expect(transitionOnboarding(before, { type, error, revealed: true }).effects).toEqual([
        { type: "show-error-toast", error },
      ])
    },
  )

  test.each([
    ["waiting for tabs", []],
    ["finishing", [{ type: "tabs.hydrated", shouldTrigger: true }]],
    ["adding the project", finished],
    ["opening the draft", [...finished, { type: "seed.succeeded", revealed: false, canOpenDraft: true }]],
  ] satisfies [string, OnboardingEvent<Tab>[]][])(
    "ignores every late result once disposed while %s",
    (_name, events) => {
      // On dev the run kept going after the shell unmounted and selected tabs and dispatched into a torn-down owner.
      const disposed = replay([...events, { type: "disposed" }]).state

      const late = replay(
        [
          { type: "tabs.hydrated", shouldTrigger: true },
          { type: "finish.succeeded", directory },
          { type: "seed.succeeded", revealed: false, canOpenDraft: true },
          { type: "draft.succeeded", tab, revealed: false },
          { type: "seed.failed", error, revealed: false },
        ],
        disposed,
      )

      expect(disposed.status).toBe("disposed")
      expect(late.state).toBe(disposed)
      expect(late.effects.flat()).toEqual([])
    },
  )

  test("ignores results for a step it is not in", () => {
    const finishing = replay([{ type: "tabs.hydrated", shouldTrigger: true }]).state

    expect(transitionOnboarding(finishing, { type: "tabs.hydrated", shouldTrigger: false }).state).toBe(finishing)
    expect(transitionOnboarding(finishing, { type: "draft.succeeded", tab, revealed: false }).state).toBe(finishing)
    expect(transitionOnboarding(finishing, { type: "seed.failed", error, revealed: false }).state).toBe(finishing)
  })
})
