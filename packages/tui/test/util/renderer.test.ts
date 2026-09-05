import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { destroyRenderer, installTerminalResizeRefresh } from "../../src/util/renderer"

test("refreshes terminal dimensions before existing SIGWINCH listeners", () => {
  const target = new EventEmitter()
  const calls: string[] = []
  target.on("SIGWINCH", () => calls.push("resize"))
  const uninstall = installTerminalResizeRefresh(target, {
    isTTY: true,
    _refreshSize() {
      calls.push("refresh")
    },
  })

  expect(calls).toEqual(["refresh"])
  calls.length = 0
  target.emit("SIGWINCH")
  expect(calls).toEqual(["refresh", "resize"])

  uninstall()
  calls.length = 0
  target.emit("SIGWINCH")
  expect(calls).toEqual(["resize"])
})

test("does not install a refresh hook for non-TTY output", () => {
  const target = new EventEmitter()
  let refreshes = 0
  installTerminalResizeRefresh(target, {
    isTTY: false,
    _refreshSize() {
      refreshes++
    },
  })

  target.emit("SIGWINCH")
  expect(refreshes).toBe(0)
  expect(target.listenerCount("SIGWINCH")).toBe(0)
})

test("clears the terminal title before destroying the renderer", () => {
  const calls: string[] = []
  destroyRenderer({
    isDestroyed: false,
    setTerminalTitle(title) {
      calls.push(`title:${title}`)
    },
    destroy() {
      calls.push("destroy")
    },
  })
  expect(calls).toEqual(["title:", "destroy"])
})

test("still clears the title after renderer destruction", () => {
  const calls: string[] = []
  destroyRenderer({
    isDestroyed: true,
    setTerminalTitle(title) {
      calls.push(`title:${title}`)
    },
    destroy() {
      calls.push("destroy")
    },
  })
  expect(calls).toEqual(["title:"])
})
