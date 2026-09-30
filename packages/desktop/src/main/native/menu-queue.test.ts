import { describe, expect, test } from "bun:test"
import { createMenuQueue } from "./menu-queue"
import type { MenuCommand } from "../../shared/menu-command"

describe("native menu command handoff", () => {
  test("queues session navigation alongside ordinary commands on a cold window", () => {
    const delivered: MenuCommand[] = []
    const queue = createMenuQueue<object, MenuCommand>((_, command) => delivered.push(command))
    const win = {}
    queue.trigger(win, { type: "session", sessionID: "ses_from_terminal" })
    queue.reset(win)
    expect(queue.ready(win)).toEqual([{ type: "session", sessionID: "ses_from_terminal" }])
    queue.trigger(win, { type: "command", id: "settings.open" })
    expect(delivered).toEqual([{ type: "command", id: "settings.open" }])
  })
  test("holds commands until a newly opened window registers its commands", () => {
    const delivered: string[] = []
    const queue = createMenuQueue(() => delivered.push("unexpected"))
    const win = {}
    queue.trigger(win, "tab.new")
    // Loading can begin after the native click creates the window.
    queue.reset(win)
    queue.trigger(win, "settings.open")
    expect(delivered).toEqual([])
    expect(queue.ready(win)).toEqual(["tab.new", "settings.open"])
    expect(queue.ready(win)).toEqual([])
  })

  test("delivers immediately to a ready window and waits again after reload", () => {
    const delivered: string[] = []
    const queue = createMenuQueue((_, id) => delivered.push(id))
    const win = {}
    queue.ready(win)
    queue.trigger(win, "settings.open")
    expect(delivered).toEqual(["settings.open"])
    queue.reset(win)
    queue.trigger(win, "tab.new")
    expect(delivered).toEqual(["settings.open"])
    expect(queue.ready(win)).toEqual(["tab.new"])
  })

  test("keeps commands isolated between windows", () => {
    const delivered: string[] = []
    const queue = createMenuQueue((_, id) => delivered.push(id))
    const first = {}
    const second = {}
    queue.ready(first)
    queue.trigger(first, "tab.new")
    queue.trigger(second, "settings.open")
    expect(delivered).toEqual(["tab.new"])
    expect(queue.ready(first)).toEqual([])
    expect(queue.ready(second)).toEqual(["settings.open"])
  })
})
