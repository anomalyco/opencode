import { describe, expect, test } from "bun:test"
import {
  INITIAL_INBOX_SELECTION_STATE,
  selectInboxAllSelected,
  selectInboxIsSelected,
  selectInboxSelectedCount,
  selectInboxSelectedKeys,
  selectInboxSelecting,
  transitionInboxSelection,
} from "./inbox-selection-machine"

const ordered = ["a", "b", "c", "d", "e"]

describe("inbox-selection-machine", () => {
  test("toggles individual items and returns to idle when the last item is deselected", () => {
    const one = transitionInboxSelection(INITIAL_INBOX_SELECTION_STATE, { type: "toggle", key: "b" })

    expect(selectInboxSelecting(one)).toBe(true)
    expect(selectInboxSelectedCount(one)).toBe(1)
    expect(selectInboxIsSelected(one, "b")).toBe(true)

    const two = transitionInboxSelection(one, { type: "toggle", key: "d" })

    expect([...selectInboxSelectedKeys(two)]).toEqual(["b", "d"])

    const back = transitionInboxSelection(two, { type: "toggle", key: "d" })

    expect([...selectInboxSelectedKeys(back)]).toEqual(["b"])
    expect(back.status === "selecting" ? back.anchor : undefined).toBe("b")

    const cleared = transitionInboxSelection(back, { type: "toggle", key: "b" })

    expect(cleared).toBe(INITIAL_INBOX_SELECTION_STATE)
    expect(selectInboxSelecting(cleared)).toBe(false)
    expect(selectInboxSelectedCount(cleared)).toBe(0)
  })

  test("range selection expands and contracts from a stable anchor", () => {
    const start = transitionInboxSelection(INITIAL_INBOX_SELECTION_STATE, { type: "toggle", key: "b" })
    const expanded = transitionInboxSelection(start, { type: "range", target: "e", ordered })

    expect([...selectInboxSelectedKeys(expanded)]).toEqual(["b", "c", "d", "e"])

    const contracted = transitionInboxSelection(expanded, { type: "range", target: "c", ordered })

    expect([...selectInboxSelectedKeys(contracted)]).toEqual(["b", "c"])

    const reversed = transitionInboxSelection(contracted, { type: "range", target: "a", ordered })

    expect([...selectInboxSelectedKeys(reversed)]).toEqual(["a", "b"])
  })

  test("range selection from idle uses fallbackAnchor when visible", () => {
    const state = transitionInboxSelection(INITIAL_INBOX_SELECTION_STATE, {
      type: "range",
      target: "d",
      ordered,
      fallbackAnchor: "b",
    })

    expect([...selectInboxSelectedKeys(state)]).toEqual(["b", "c", "d"])
  })

  test("additive range selection preserves earlier disjoint picks", () => {
    const first = transitionInboxSelection(INITIAL_INBOX_SELECTION_STATE, { type: "toggle", key: "a" })
    const second = transitionInboxSelection(first, { type: "toggle", key: "c" })
    const added = transitionInboxSelection(second, { type: "range", target: "e", ordered, additive: true })

    expect([...selectInboxSelectedKeys(added)]).toEqual(["a", "c", "d", "e"])
  })

  test("section toggle selects an entire section and deselects it when already all selected", () => {
    const picked = transitionInboxSelection(INITIAL_INBOX_SELECTION_STATE, {
      type: "section.toggle",
      keys: ["b", "c"],
    })

    expect([...selectInboxSelectedKeys(picked)]).toEqual(["b", "c"])
    expect(selectInboxAllSelected(picked, ["b", "c"])).toBe(true)

    const merged = transitionInboxSelection(picked, { type: "section.toggle", keys: ["d", "e"] })

    expect([...selectInboxSelectedKeys(merged)]).toEqual(["b", "c", "d", "e"])

    const withoutFirst = transitionInboxSelection(merged, { type: "section.toggle", keys: ["b", "c"] })

    expect([...selectInboxSelectedKeys(withoutFirst)]).toEqual(["d", "e"])

    const empty = transitionInboxSelection(withoutFirst, { type: "section.toggle", keys: ["d", "e"] })

    expect(empty).toBe(INITIAL_INBOX_SELECTION_STATE)
  })

  test("sync.visible prunes disappeared keys and returns the same reference when unchanged", () => {
    const all = transitionInboxSelection(INITIAL_INBOX_SELECTION_STATE, { type: "select.all", ordered })
    const unchanged = transitionInboxSelection(all, { type: "sync.visible", visible: new Set(ordered) })

    expect(unchanged).toBe(all)

    const pruned = transitionInboxSelection(all, { type: "sync.visible", visible: new Set(["c", "e"]) })

    expect([...selectInboxSelectedKeys(pruned)]).toEqual(["c", "e"])
    expect(pruned.status === "selecting" ? pruned.anchor : undefined).toBe("c")

    const empty = transitionInboxSelection(pruned, { type: "sync.visible", visible: new Set(["x"]) })

    expect(empty).toBe(INITIAL_INBOX_SELECTION_STATE)
  })

  test("clear returns idle and is a no-op when already idle", () => {
    expect(transitionInboxSelection(INITIAL_INBOX_SELECTION_STATE, { type: "clear" })).toBe(
      INITIAL_INBOX_SELECTION_STATE,
    )

    const picked = transitionInboxSelection(INITIAL_INBOX_SELECTION_STATE, { type: "select.all", ordered })

    expect(transitionInboxSelection(picked, { type: "clear" })).toBe(INITIAL_INBOX_SELECTION_STATE)
  })
})
