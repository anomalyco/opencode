import { describe, expect, test } from "bun:test"
import { isReservedTerminalShortcut, isTerminalEvent, upsertCommandRegistration } from "./command"

describe("upsertCommandRegistration", () => {
  test("replaces keyed registrations", () => {
    const one = () => [{ id: "one", title: "One" }]
    const two = () => [{ id: "two", title: "Two" }]

    const next = upsertCommandRegistration([{ key: "layout", options: one }], { key: "layout", options: two })

    expect(next).toHaveLength(1)
    expect(next[0]?.options).toBe(two)
  })

  test("keeps unkeyed registrations additive", () => {
    const one = () => [{ id: "one", title: "One" }]
    const two = () => [{ id: "two", title: "Two" }]

    const next = upsertCommandRegistration([{ options: one }], { options: two })

    expect(next).toHaveLength(2)
    expect(next[0]?.options).toBe(two)
    expect(next[1]?.options).toBe(one)
  })
})

describe("isTerminalEvent", () => {
  test("returns true for events from inside terminal component", () => {
    document.body.innerHTML = `<div data-component="terminal"><textarea></textarea></div>`
    const target = document.querySelector("textarea")
    expect(isTerminalEvent({ target, composedPath: () => [target] })).toBe(true)
  })

  test("returns false for events outside terminal component", () => {
    document.body.innerHTML = `<div><button>Run</button></div>`
    const target = document.querySelector("button")
    expect(isTerminalEvent({ target, composedPath: () => [target] })).toBe(false)
  })

  test("returns true when active element is in terminal even if event target is window", () => {
    document.body.innerHTML = `<div data-component="terminal"><textarea id="t"></textarea></div>`
    const target = document.querySelector("#t") as HTMLTextAreaElement
    target.focus()
    expect(document.activeElement).toBe(target)
    expect(isTerminalEvent({ target: window, composedPath: () => [window] })).toBe(true)
  })
})

describe("isReservedTerminalShortcut", () => {
  test("returns true for terminal-conflicting shortcuts", () => {
    expect(isReservedTerminalShortcut("d:2")).toBe(true)
    expect(isReservedTerminalShortcut("d:6")).toBe(true)
    expect(isReservedTerminalShortcut("w:2")).toBe(true)
  })

  test("returns false for non-conflicting shortcuts", () => {
    expect(isReservedTerminalShortcut("\\:2")).toBe(false)
    expect(isReservedTerminalShortcut("1:2")).toBe(false)
    expect(isReservedTerminalShortcut("p:6")).toBe(false)
  })
})
