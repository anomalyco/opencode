import { describe, expect, test } from "bun:test"
import {
  headerFitCollapse,
  headerFitCompact,
  INITIAL_HEADER_FIT_STATE,
  transitionHeaderFit,
  type HeaderFitMeasuredEvent,
  type HeaderFitState,
} from "./fit-machine"

// A header laid out like the real one: the location takes its rendered width, the actions theirs, and the title box
// fills the rest of the row. The project name takes 80px and the worktree name 100px, each with its gap.
const title = 300

const usage = 146

const usageSaved = 82

const find = 208

function actions(compact: boolean, search = false) {
  return usage - (compact ? usageSaved : 0) + (search ? find : 0)
}

function measured(
  state: HeaderFitState,
  row: number,
  input: { search?: boolean; worktree?: boolean; actions?: boolean; limit?: number } = {},
): HeaderFitMeasuredEvent {
  const worktree = input.worktree ?? true
  const collapse = headerFitCollapse(state)
  const location = 40 + (collapse < 2 ? 80 : 0) + (worktree && collapse < 1 ? 100 : 0)
  const width = input.actions === false ? 0 : actions(headerFitCompact(state), input.search)

  return {
    type: "measured",
    locationWidth: location,
    titleBoxWidth: row - location - width,
    titleWidth: title,
    projectWidth: 80,
    worktreeWidth: worktree ? 100 : 0,
    hasWorktree: worktree,
    limit: input.limit ?? Number.POSITIVE_INFINITY,
    hasActions: input.actions !== false,
    actionsWidth: width,
  }
}

// Fits like the driver: a pass that enters compact measures the actions once they render compact.
function fit(state: HeaderFitState, row: number, input: Parameters<typeof measured>[2] = {}) {
  const next = transitionHeaderFit(state, measured(state, row, input))

  if (next.status !== "compact" || next.expandedWidth === undefined) return next

  return transitionHeaderFit(next, {
    type: "compact.settled",
    actionsWidth: input.actions === false ? 0 : actions(true, input.search),
  })
}

// Fits until the header stops changing, as the observers do after each render.
function settle(state: HeaderFitState, row: number, input: Parameters<typeof measured>[2] = {}) {
  const seen: HeaderFitState[] = [state]

  for (let pass = 0; pass < 4; pass++) {
    const next = fit(seen.at(-1) ?? state, row, input)

    if (next === seen.at(-1)) return { state: next, passes: seen.slice(1) }
    seen.push(next)
  }

  throw new Error(`header kept changing: ${seen.map((item) => item.status).join(" -> ")}`)
}

describe("transitionHeaderFit", () => {
  test("closing Find while compact expands the actions again", () => {
    const opened = settle(INITIAL_HEADER_FIT_STATE, 680, { search: true }).state
    expect(opened).toEqual({ status: "compact", expandedWidth: undefined, saved: usageSaved })

    // The old fit subtracted the 354px the actions took with Find open, not the 82px compacting freed.
    expect(fit(opened, 680)).toBe(INITIAL_HEADER_FIT_STATE)
  })

  test("opening Find while compact keeps the room the details take, so the header does not flip back and forth", () => {
    const compact = settle(INITIAL_HEADER_FIT_STATE, 480).state
    expect(compact).toEqual({ status: "compact", expandedWidth: undefined, saved: usageSaved })

    // 40px to spare beside the compact actions, less than their details take back.
    const searching = settle(compact, 652, { search: true })
    expect(searching.state).toBe(compact)
    expect(searching.passes).toEqual([])

    // Once the details fit, they expand and stay.
    const expanded = settle(compact, 694, { search: true })
    expect(expanded.passes.map((state) => state.status)).toEqual(["project-hidden"])
  })

  test("hides the worktree name, then the project name, then the details, and restores them in reverse", () => {
    const states = [700, 600, 500, 480, 500, 600, 700].reduce<HeaderFitState[]>((list, row) => {
      list.push(settle(list.at(-1) ?? INITIAL_HEADER_FIT_STATE, row).state)

      return list
    }, [])

    expect(states.map((state) => [headerFitCollapse(state), headerFitCompact(state)])).toEqual([
      [0, false],
      [1, false],
      [2, false],
      [2, true],
      [2, false],
      [1, false],
      [0, false],
    ])
  })

  test("skips the worktree step without a worktree and never compacts without actions", () => {
    expect(settle(INITIAL_HEADER_FIT_STATE, 550, { worktree: false }).state.status).toBe("project-hidden")
    expect(settle(INITIAL_HEADER_FIT_STATE, 300, { actions: false }).state.status).toBe("project-hidden")
  })

  test("fits each candidate against the location's maximum width", () => {
    // 154px is free: the full 220px location does not fit, but its 100px cap does.
    expect(settle(INITIAL_HEADER_FIT_STATE, 600).state.status).toBe("worktree-hidden")
    expect(settle(INITIAL_HEADER_FIT_STATE, 600, { limit: 100 }).state).toBe(INITIAL_HEADER_FIT_STATE)
  })

  test("returns the same state while the header keeps fitting the same way", () => {
    for (const row of [700, 600, 500, 480]) {
      const state = settle(INITIAL_HEADER_FIT_STATE, row).state

      expect(transitionHeaderFit(state, measured(state, row))).toBe(state)
      expect(transitionHeaderFit(state, measured(state, row - 2))).toBe(state)
    }
  })

  test("ignores a compact measurement outside the compact entry", () => {
    const settled = { type: "compact.settled", actionsWidth: 64 } as const

    expect(transitionHeaderFit(INITIAL_HEADER_FIT_STATE, settled)).toBe(INITIAL_HEADER_FIT_STATE)
    const compact = settle(INITIAL_HEADER_FIT_STATE, 480).state
    expect(transitionHeaderFit(compact, settled)).toBe(compact)
  })
})
