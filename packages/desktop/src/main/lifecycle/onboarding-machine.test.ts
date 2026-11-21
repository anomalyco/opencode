import { describe, expect, test } from "bun:test"
import {
  createMainOnboardingState,
  selectOnboardingPending,
  transitionMainOnboarding,
  type MainOnboardingCommand,
  type MainOnboardingEvent,
  type MainOnboardingState,
} from "./onboarding-machine"

const directory = "/Users/me/Documents/OpenCode"

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly MainOnboardingEvent[], from: MainOnboardingState = createMainOnboardingState()) {
  return events.reduce<{ state: MainOnboardingState; commands: (readonly MainOnboardingCommand[])[] }>(
    (result, event) => {
      const next = transitionMainOnboarding(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

const fresh: MainOnboardingEvent = { type: "initialized", complete: false }

describe("first-launch onboarding in main", () => {
  test("creates the default project once when two windows finish together", () => {
    // On dev both windows passed the pending check before either recorded completion, so the project was created twice
    // and both windows opened a draft.
    const run = replay([
      fresh,
      { type: "finish.requested", directory },
      { type: "finish.requested", directory },
      { type: "finish.succeeded", attempt: 1 },
    ])

    expect(run.commands).toEqual([
      [],
      [{ type: "make-directory", attempt: 1, directory }],
      [],
      [{ type: "persist-complete" }],
    ])
    expect(run.state.status).toBe("completed")
  })

  test("tells a window opened while another finishes not to onboard", () => {
    const finishing = replay([fresh, { type: "finish.requested", directory }]).state

    expect(selectOnboardingPending(replay([fresh]).state)).toBe(true)
    expect(selectOnboardingPending(finishing)).toBe(false)
  })

  test("releases the claim when creating the project fails, and ignores the failed attempt after a retry", () => {
    const run = replay([
      fresh,
      { type: "finish.requested", directory },
      { type: "finish.failed", attempt: 1 },
      { type: "finish.requested", directory },
      { type: "finish.succeeded", attempt: 1 },
      { type: "finish.succeeded", attempt: 2 },
    ])

    expect(run.commands.slice(2)).toEqual([
      [],
      [{ type: "make-directory", attempt: 2, directory }],
      [],
      [{ type: "persist-complete" }],
    ])
    expect(run.state.status).toBe("completed")
  })

  test("completes without a project when the window does not create one", () => {
    const run = replay([fresh, { type: "finish.requested", directory: null }])

    expect(run.commands.at(-1)).toEqual([{ type: "persist-complete" }])
    expect(selectOnboardingPending(run.state)).toBe(false)
  })

  test("does nothing on a launch that already onboarded", () => {
    const completed = replay([{ type: "initialized", complete: true }]).state
    const result = transitionMainOnboarding(completed, { type: "finish.requested", directory })

    expect(selectOnboardingPending(completed)).toBe(false)
    expect(result.state).toBe(completed)
    expect(result.commands).toEqual([])
  })
})
