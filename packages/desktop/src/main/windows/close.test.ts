import { describe, expect, test } from "bun:test"
import {
  closeChoiceFromStored,
  closeDialogOptions,
  needsTrayCloseDecision,
  readDialogOutcome,
  transition,
} from "./close"

describe("needsTrayCloseDecision", () => {
  test.each<{
    name: string
    input: { tray: boolean; quitting: boolean; openWindows: number }
    expected: boolean
  }>([
    {
      name: "asks about the last window while the tray keeps the app reachable",
      input: { tray: true, quitting: false, openWindows: 0 },
      expected: true,
    },
    {
      name: "closes the last window during a quit, so Electron finishes it",
      input: { tray: true, quitting: true, openWindows: 0 },
      expected: false,
    },
    {
      name: "closes a window while another one stays open",
      input: { tray: true, quitting: false, openWindows: 1 },
      expected: false,
    },
    {
      name: "closes the last window without a tray icon to come back from",
      input: { tray: false, quitting: false, openWindows: 0 },
      expected: false,
    },
  ])("$name", ({ input, expected }) => {
    expect(needsTrayCloseDecision(input)).toBe(expected)
  })
})

describe("closeChoiceFromStored", () => {
  test.each<{ name: string; stored: unknown; expected: string }>([
    { name: "uses a remembered ask", stored: "ask", expected: "ask" },
    { name: "uses a remembered hide", stored: "hide", expected: "hide" },
    { name: "uses a remembered quit", stored: "quit", expected: "quit" },
    { name: "quits without a stored choice", stored: undefined, expected: "quit" },
    { name: "quits when the stored value is not a choice", stored: "minimize", expected: "quit" },
  ])("$name", ({ stored, expected }) => {
    expect(closeChoiceFromStored(stored)).toBe(expected)
  })
})

describe("readDialogOutcome", () => {
  test.each<{
    name: string
    response: number
    checkboxChecked: boolean
    expected: { action: string | undefined; remember: boolean }
  }>([
    {
      name: "hides and remembers when Hide is checked",
      response: 0,
      checkboxChecked: true,
      expected: { action: "hide", remember: true },
    },
    {
      name: "quits and remembers when Quit is checked",
      response: 1,
      checkboxChecked: true,
      expected: { action: "quit", remember: true },
    },
    {
      name: "never remembers a cancelled dialog",
      response: 2,
      checkboxChecked: true,
      expected: { action: undefined, remember: false },
    },
    {
      name: "hides without remembering when an unexpected response arrives",
      response: -1,
      checkboxChecked: false,
      expected: { action: "hide", remember: false },
    },
  ])("$name", ({ response, checkboxChecked, expected }) => {
    expect(readDialogOutcome(response, checkboxChecked)).toEqual(expected)
  })
})

describe("closeDialogOptions", () => {
  test("shows no icon so Windows does not play a notification sound", () => {
    expect(closeDialogOptions().type).toBe("none")
  })
})

describe("close prompt transition", () => {
  const idle = { status: "idle" } as const
  const asking = { status: "asking" } as const

  test("a close request starts the prompt", () => {
    expect(transition(idle, { type: "request" })).toEqual(asking)
  })

  test("a second close request cannot open another dialog", () => {
    expect(transition(asking, { type: "request" })).toBe(asking)
  })

  test("a resolved dialog accepts the next close request", () => {
    expect(transition(asking, { type: "resolved" })).toEqual(idle)
  })

  test("a stray resolution leaves the idle state alone", () => {
    expect(transition(idle, { type: "resolved" })).toBe(idle)
  })
})
