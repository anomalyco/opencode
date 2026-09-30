import { describe, expect, test } from "bun:test"
import { createTrayTabs } from "./tray-tabs"
import type { TrayAvatar } from "../../shared/tray-avatar"

describe("tray tab inventory", () => {
  test("publishes avatar changes even when the same tabs remain open", () => {
    const tabs = createTrayTabs()
    const avatar: TrayAvatar = {
      name: "Project",
      background: "#263fa9",
      border: "#7698fd",
      foreground: "#fff",
      highlight: "#ffffff29",
      accent: "#3b5cf6",
    }
    const changes: string[] = []
    tabs.subscribe(() => changes.push(tabs.avatar("a")?.background ?? "none"))
    tabs.set(1, ["a"], { a: avatar })
    tabs.set(1, ["a"], { a: { ...avatar } })
    tabs.set(1, ["a"], { a: { ...avatar, background: "#3250df" } })
    expect(changes).toEqual(["#263fa9", "#3250df"])
    tabs.remove(1)
    expect(tabs.avatar("a")).toBeUndefined()
  })
  test("deduplicates open sessions across windows and preserves tab order", () => {
    const tabs = createTrayTabs()
    tabs.set(1, ["b", "a", "b"])
    tabs.set(2, ["a", "c"])
    expect(tabs.sessions()).toEqual(["b", "a", "c"])
    expect(tabs.owner("a", 2)).toBe(2)
    expect(tabs.owner("b", 2)).toBe(1)
  })

  test("removes closed tabs and windows without removing a tab still open elsewhere", () => {
    const tabs = createTrayTabs()
    tabs.set(1, ["a", "b"])
    tabs.set(2, ["b", "c"])
    tabs.set(1, ["b"])
    expect(tabs.sessions()).toEqual(["b", "c"])
    expect(tabs.owner("a")).toBeUndefined()
    tabs.remove(1)
    expect(tabs.sessions()).toEqual(["b", "c"])
    tabs.remove(2)
    expect(tabs.sessions()).toEqual([])
  })

  test("notifies only when the inventory changes and releases subscribers", () => {
    const tabs = createTrayTabs()
    const changes: string[][] = []
    const unsubscribe = tabs.subscribe(() => changes.push(tabs.sessions()))
    tabs.set(1, ["a"])
    tabs.set(1, ["a"])
    tabs.set(1, ["b"])
    tabs.remove(1)
    tabs.remove(1)
    unsubscribe()
    tabs.set(2, ["c"])
    expect(changes).toEqual([["a"], ["b"], []])
  })
})
