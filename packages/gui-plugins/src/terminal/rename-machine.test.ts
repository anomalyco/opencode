import { describe, expect, test } from "bun:test"
import {
  initialRenameState,
  transitionRename,
  type RenameEvent,
  type RenameState,
  type RenameTransition,
} from "./rename-machine"

const replay = (events: readonly RenameEvent[], state: RenameState = initialRenameState) =>
  events.reduce<RenameTransition>((last, event) => transitionRename(last.state, event), { state, effects: [] })

const start = (source: "pointer" | "menu" = "pointer"): RenameEvent => ({
  type: "start",
  title: "Terminal 1",
  source,
  enabled: true,
})

describe("terminal rename machine", () => {
  test("starting again while renaming keeps the edit, which still saves on blur", () => {
    const editing = replay([start(), { type: "armed", attempt: 1 }, { type: "change", value: "Build" }]).state

    // Before, a second double-click or menu Rename left blur and Enter ignored for good.
    const again = transitionRename(editing, start("menu"))

    expect(again.state).toBe(editing)
    expect(again.effects).toEqual([])
    expect(transitionRename(again.state, { type: "blur" })).toEqual({
      state: { status: "idle", issued: 1 },
      effects: [{ type: "save", title: "Build" }],
    })

    const arming = replay([start()]).state

    expect(transitionRename(arming, start()).state).toBe(arming)
  })

  test("Enter before the field armed saves the typed title", () => {
    const submitted = replay([start(), { type: "change", value: "Dev" }, { type: "submit" }])

    // Before, Enter in the first frame was dropped.
    expect(submitted).toEqual({
      state: { status: "idle", issued: 1 },
      effects: [{ type: "disarm" }, { type: "save", title: "Dev" }],
    })
    expect(transitionRename(submitted.state, { type: "armed", attempt: 1 }).state).toBe(submitted.state)
  })

  test("a blur while arming is ignored; once armed, blur saves once", () => {
    const arming = replay([start()])

    expect(arming.effects).toEqual([{ type: "arm", attempt: 1, source: "pointer" }])
    expect(transitionRename(arming.state, { type: "blur" }).state).toBe(arming.state)

    const saved = replay([{ type: "armed", attempt: 1 }, { type: "blur" }], arming.state)

    expect(saved.effects).toEqual([{ type: "save", title: "Terminal 1" }])

    // The field's blur as it unmounts finds nothing to save.
    expect(transitionRename(saved.state, { type: "blur" })).toEqual({ state: saved.state, effects: [] })
  })

  test("Escape cancels without saving", () => {
    const cancelled = replay([
      start(),
      { type: "armed", attempt: 1 },
      { type: "change", value: "Temp" },
      { type: "cancel" },
    ])

    expect(cancelled).toEqual({ state: { status: "idle", issued: 1 }, effects: [] })
    expect(transitionRename(cancelled.state, { type: "blur" }).effects).toEqual([])
    expect(replay([start("menu"), { type: "cancel" }]).effects).toEqual([{ type: "disarm" }])
  })

  test("an emptied field saves null, and a typed draft is kept from selection when the field arms", () => {
    expect(
      replay([start(), { type: "armed", attempt: 1 }, { type: "change", value: "   " }, { type: "submit" }]).effects,
    ).toEqual([{ type: "save", title: null }])
    expect(replay([start(), { type: "change", value: "Dev" }]).state).toMatchObject({ edited: true, draft: "Dev" })
  })

  test("a terminal that cannot be renamed, or an arm from an earlier attempt, changes nothing", () => {
    const disabled = transitionRename(initialRenameState, {
      type: "start",
      title: "Terminal 1",
      source: "pointer",
      enabled: false,
    })

    expect(disabled.state).toBe(initialRenameState)

    const second = replay([start(), { type: "cancel" }, start("menu")])

    expect(second.effects).toEqual([{ type: "arm", attempt: 2, source: "menu" }])
    expect(transitionRename(second.state, { type: "armed", attempt: 1 }).state).toBe(second.state)
  })
})
