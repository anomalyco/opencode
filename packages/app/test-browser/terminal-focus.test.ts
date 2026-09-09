import { describe, expect, test } from "bun:test"
import { focusTerminalById } from "@opencode/plugin-terminal-desktop/helpers"

describe("terminal focus", () => {
  test("focuses textarea when present", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-one"><div data-component="terminal"><textarea></textarea></div></div>`
    expect(focusTerminalById("one")).toBe(true)
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })
  test("falls back to the terminal element", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-two"><div data-component="terminal" tabindex="0"></div></div>`
    const terminal = document.querySelector('[data-component="terminal"]')
    let pointerDown = false
    terminal?.addEventListener("pointerdown", () => {
      pointerDown = true
    })
    expect(focusTerminalById("two")).toBe(true)
    expect(document.activeElement).toBe(terminal)
    expect(pointerDown).toBe(true)
  })
})
