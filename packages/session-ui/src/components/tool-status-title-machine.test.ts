import { describe, expect, test } from "bun:test"
import {
  createToolStatusTitleState,
  DISPOSED_TOOL_STATUS_TITLE_EVENT,
  DISPOSED_TOOL_STATUS_TITLE_STATE,
  transitionToolStatusTitle,
  viewToolStatusTitle,
  type ToolStatusMode,
  type ToolStatusTitleState,
} from "./tool-status-title-machine"

const idle = createToolStatusTitleState({ active: true, mode: "swap", text: "Exploring" })

const sync = (
  state: ToolStatusTitleState,
  input: { active: boolean; text: string; width: string | undefined; mode?: ToolStatusMode; reducedMotion?: boolean },
) =>
  transitionToolStatusTitle(state, {
    type: "sync",
    active: input.active,
    mode: input.mode ?? "swap",
    text: input.text,
    width: input.width,
    reducedMotion: input.reducedMotion ?? false,
  })

describe("transitionToolStatusTitle", () => {
  test("animates from the current width to the measured one, then settles", () => {
    const measuring = sync(idle, { active: false, text: "Explored", width: "72px" })

    expect(measuring).toMatchObject({ status: "measuring", attempt: 1, from: "72px", crossfade: true })
    expect(viewToolStatusTitle(measuring)).toEqual({
      active: false,
      animating: true,
      width: "72px",
      showActive: true,
      showDone: true,
    })

    const animating = transitionToolStatusTitle(measuring, { type: "measured", attempt: 1, width: "64px" })

    expect(animating).toMatchObject({ status: "animating", attempt: 1, width: "64px" })
    expect(transitionToolStatusTitle(animating, { type: "settled", attempt: 1 })).toEqual({
      status: "idle",
      active: false,
      mode: "swap",
      text: "Explored",
      attempts: 1,
    })
  })

  test("does not pin a 0px width in a hidden tab", () => {
    // Before the machine, a hidden title measured "0px" and kept that width, clipping the title for 600 ms.
    const hidden = sync(idle, { active: false, text: "Explored", width: undefined })

    expect(hidden).toMatchObject({ status: "idle", active: false })
    expect(viewToolStatusTitle(hidden).width).toBeUndefined()

    const measuring = sync(idle, { active: false, text: "Explored", width: "72px" })

    expect(transitionToolStatusTitle(measuring, { type: "measured", attempt: 1, width: undefined })).toMatchObject({
      status: "idle",
      attempts: 1,
    })
  })

  test("ignores a change to the hidden text", () => {
    // Before the machine, a new done text while active mounted both texts and pinned the width for 600 ms.
    expect(sync(idle, { active: true, text: "Exploring", width: "72px" })).toBe(idle)
  })

  test("snaps when the title switches between suffix and swap", () => {
    const measuring = sync(idle, { active: false, text: "Explored", width: "72px" })
    const switched = sync(measuring, { active: false, text: "ed", width: "72px", mode: "suffix" })

    expect(switched).toEqual({ status: "idle", active: false, mode: "suffix", text: "ed", attempts: 1 })
    expect(transitionToolStatusTitle(switched, { type: "measured", attempt: 1, width: "20px" })).toBe(switched)
  })

  test("snaps under reduced motion", () => {
    expect(sync(idle, { active: false, text: "Explored", width: "72px", reducedMotion: true })).toMatchObject({
      status: "idle",
      active: false,
    })
  })

  test("crossfades an active change at the same width but settles a same-width text change at once", () => {
    const flipped = sync(idle, { active: false, text: "Explored", width: "72px" })

    expect(transitionToolStatusTitle(flipped, { type: "measured", attempt: 1, width: "72px" })).toMatchObject({
      status: "animating",
    })

    const renamed = sync(idle, { active: true, text: "Searching", width: "72px" })

    expect(renamed).toMatchObject({ status: "measuring", crossfade: false })
    expect(transitionToolStatusTitle(renamed, { type: "measured", attempt: 1, width: "72px" })).toMatchObject({
      status: "idle",
      text: "Searching",
    })
  })

  test("restarts on a reversal and ignores the earlier frame and timer", () => {
    const first = sync(idle, { active: false, text: "Explored", width: "72px" })
    const second = sync(first, { active: true, text: "Exploring", width: "70px" })

    expect(second).toMatchObject({ status: "measuring", attempt: 2, crossfade: true })
    expect(transitionToolStatusTitle(second, { type: "measured", attempt: 1, width: "64px" })).toBe(second)

    const animating = transitionToolStatusTitle(second, { type: "measured", attempt: 2, width: "72px" })

    expect(transitionToolStatusTitle(animating, { type: "settled", attempt: 1 })).toBe(animating)
    expect(transitionToolStatusTitle(idle, { type: "settled", attempt: 0 })).toBe(idle)
  })

  test("stops after disposal", () => {
    const measuring = sync(idle, { active: false, text: "Explored", width: "72px" })
    const disposed = transitionToolStatusTitle(measuring, DISPOSED_TOOL_STATUS_TITLE_EVENT)

    expect(disposed).toBe(DISPOSED_TOOL_STATUS_TITLE_STATE)
    expect(transitionToolStatusTitle(disposed, { type: "measured", attempt: 1, width: "64px" })).toBe(disposed)
    expect(sync(disposed, { active: true, text: "Exploring", width: "72px" })).toBe(disposed)
  })
})
