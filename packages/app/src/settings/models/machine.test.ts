import { describe, expect, test } from "bun:test"
import {
  createModelsRevealState,
  transitionModelsReveal,
  type ModelsRevealEvent,
  type ModelsRevealState,
} from "./machine"

function run(events: readonly ModelsRevealEvent[], state: ModelsRevealState = createModelsRevealState()) {
  return events.reduce<{ state: ModelsRevealState; effects: unknown[] }>(
    (current, event) => {
      const next = transitionModelsReveal(current.state, event)

      return { state: next.state, effects: [...next.effects] }
    },
    { state, effects: [] },
  )
}

const target = (provider: string | undefined, active = true): ModelsRevealEvent => ({
  type: "target.synced",
  active,
  provider,
  hasFilter: false,
})

const catalog = (input: Partial<Extract<ModelsRevealEvent, { type: "catalog.synced" }>>): ModelsRevealEvent => ({
  type: "catalog.synced",
  hasFilter: false,
  inCatalog: true,
  inConsoleGroup: false,
  sectionReady: false,
  ...input,
})

describe("settings models reveal", () => {
  test("a provider nested in a collapsed Console group expands the group before its section exists", () => {
    const waiting = run([target("console-google")])
    expect(waiting.effects).toEqual([{ type: "timeout.start", attempt: 1, timeoutMs: 5_000 }])

    const expanded = run([catalog({ inConsoleGroup: true })], waiting.state)
    expect(expanded.effects).toEqual([{ type: "section.expand", provider: "console-google", expandConsole: true }])

    const scrolling = run([{ type: "section.ready", provider: "console-google" }], expanded.state)
    expect(scrolling.state).toEqual({ status: "scrolling", attempt: 1, provider: "console-google" })
    expect(scrolling.effects).toEqual([
      { type: "timeout.cancel" },
      { type: "frame.scroll", attempt: 1, provider: "console-google" },
    ])

    expect(run([{ type: "frame.completed", attempt: 1 }], scrolling.state)).toEqual({
      state: { status: "idle", attempt: 1 },
      effects: [{ type: "target.consume" }],
    })
  })

  test("a provider without models never clears typing and gives up after the timeout", () => {
    const waiting = run([target("console-empty"), catalog({ inCatalog: false })])
    expect(waiting.state.status).toBe("waiting")

    const typed = run([{ type: "filter.typed" }], waiting.state)
    expect(typed.state).toEqual({ status: "idle", attempt: 1 })
    expect(typed.effects).toEqual([{ type: "timeout.cancel" }, { type: "target.consume" }])
    // Later catalog changes with a typed filter do nothing.
    expect(transitionModelsReveal(typed.state, catalog({ hasFilter: true })).state).toBe(typed.state)

    expect(run([{ type: "reveal.timed-out", attempt: 1 }], waiting.state)).toEqual({
      state: { status: "idle", attempt: 1 },
      effects: [{ type: "target.consume" }],
    })
  })

  test("leaving the Models tab mid-reveal drops the target, so a later visit does not jump", () => {
    const left = run([target("anthropic"), target("anthropic", false)])
    expect(left.state).toEqual({ status: "idle", attempt: 1 })
    expect(left.effects).toEqual([{ type: "timeout.cancel" }, { type: "target.consume" }])

    // A target set while the Providers tab still shows waits for the Models tab.
    const idle = createModelsRevealState()
    expect(transitionModelsReveal(idle, target("anthropic", false)).state).toBe(idle)
  })

  test("a search typed before the reveal is cleared once, when it starts", () => {
    expect(run([{ type: "target.synced", active: true, provider: "anthropic", hasFilter: true }]).effects).toEqual([
      { type: "filter.clear" },
      { type: "timeout.start", attempt: 1, timeoutMs: 5_000 },
    ])
  })

  test("a listed section scrolls on the next frame, expanding the provider itself first", () => {
    expect(run([target("anthropic"), catalog({ sectionReady: true })]).effects).toEqual([
      { type: "section.expand", provider: "anthropic", expandConsole: false },
      { type: "timeout.cancel" },
      { type: "frame.scroll", attempt: 1, provider: "anthropic" },
    ])
  })

  test("extra syncs while scrolling are ignored, and disposal cancels the frame and rejects its late completion", () => {
    const scrolling = run([target("anthropic"), catalog({ sectionReady: true })])

    for (const event of [
      catalog({ sectionReady: true }),
      { type: "section.ready", provider: "anthropic" },
      target("anthropic"),
    ] as const)
      expect(transitionModelsReveal(scrolling.state, event).state).toBe(scrolling.state)

    const disposed = run([{ type: "disposed" }], scrolling.state)
    expect(disposed.effects).toEqual([{ type: "frame.cancel" }, { type: "target.consume" }])
    expect(transitionModelsReveal(disposed.state, { type: "frame.completed", attempt: 1 }).state).toBe(disposed.state)
  })

  test("another provider starts a new attempt, so the previous attempt's timeout and frame are stale", () => {
    const first = run([target("anthropic")])
    const second = run([target("openai")], first.state)
    expect(second.state).toEqual({ status: "waiting", attempt: 2, provider: "openai", expanded: false })
    expect(second.effects).toEqual([
      { type: "timeout.cancel" },
      { type: "timeout.start", attempt: 2, timeoutMs: 5_000 },
    ])
    expect(transitionModelsReveal(second.state, { type: "reveal.timed-out", attempt: 1 }).state).toBe(second.state)
  })
})
