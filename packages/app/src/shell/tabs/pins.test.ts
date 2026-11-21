import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import {
  createGroup,
  EMPTY_PINS,
  groupOf,
  isPinned,
  moveToGroup,
  pin,
  pinnedRefs,
  removeFromGroup,
  toggleGroup,
  ungroup,
  unpin,
  unpinGroup,
  type PinRef,
} from "./pins"

const server = ServerConnection.Key.make("http://127.0.0.1:4096")

const ref = (sessionId: string): PinRef => ({ server, sessionId })

const group = (id: string) => ({ id, name: id, color: "blue" as const })

describe("pins", () => {
  test("groups only hold pinned sessions: grouping pins, and unpinning leaves the group", () => {
    const grouped = createGroup(EMPTY_PINS, ref("a"), group("g"))
    expect(isPinned(grouped, ref("a"))).toBe(true)
    expect(groupOf(grouped, ref("a"))?.id).toBe("g")

    const unpinned = unpin(grouped, ref("a"))
    expect(isPinned(unpinned, ref("a"))).toBe(false)
    expect(unpinned.items).toEqual([])
  })

  test("a group starts where its first session was pinned, and taking a session out keeps it pinned after the group", () => {
    const state = createGroup(pin(pin(pin(EMPTY_PINS, ref("a")), ref("b")), ref("c")), ref("b"), group("g"))
    expect(state.items.map((item) => (item.type === "group" ? item.id : item.sessionId))).toEqual(["a", "g", "c"])

    const joined = moveToGroup(state, ref("c"), "g")
    expect(pinnedRefs(joined).map((item) => item.sessionId)).toEqual(["a", "b", "c"])

    const out = removeFromGroup(joined, ref("b"))
    expect(out.items.map((item) => (item.type === "group" ? item.id : item.sessionId))).toEqual(["a", "g", "b"])
    expect(isPinned(out, ref("b"))).toBe(true)
  })

  test("ungrouping keeps sessions pinned in place; unpinning a group unpins them", () => {
    const state = moveToGroup(createGroup(pin(EMPTY_PINS, ref("a")), ref("b"), group("g")), ref("c"), "g")
    expect(ungroup(state, "g").items.map((item) => (item.type === "group" ? item.id : item.sessionId))).toEqual([
      "a",
      "b",
      "c",
    ])
    expect(pinnedRefs(unpinGroup(state, "g")).map((item) => item.sessionId)).toEqual(["a"])
  })

  test("opening a group collapses the others, and no-op operations return the same state", () => {
    const state = createGroup(createGroup(EMPTY_PINS, ref("a"), group("g1")), ref("b"), group("g2"))
    const opened = toggleGroup(toggleGroup(state, "g1"), "g2")
    expect(opened.collapsed).toEqual({ g1: true, g2: false })
    expect(toggleGroup(opened, "g2").collapsed).toEqual({ g1: true, g2: true })

    expect(pin(state, ref("a"))).toBe(state)
    expect(unpin(state, ref("zzz"))).toBe(state)
    expect(moveToGroup(state, ref("a"), "g1")).toBe(state)
  })
})
