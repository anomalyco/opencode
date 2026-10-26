import { afterEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { ServerRef, Sessions, Storage } from "../sdk"
import { createTerminalModel } from "./model"

// SAFETY: the workspace model reads only these members when it loads and handles focus.
const storage = {
  memory: (_key: string, options: { initial: unknown }) => [options.initial],
  store: () => ({ value: { all: [] }, ready: () => true }),
} as unknown as Storage

// SAFETY: load reads only sessions.list and server.id.
const sessions = { list: () => [] } as unknown as Sessions

// SAFETY: load reads only sessions.list and server.id.
const server = { id: "server" } as unknown as ServerRef

const cleanups: VoidFunction[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.replaceChildren()
})

const workspace = () =>
  createRoot((dispose) => {
    cleanups.push(dispose)

    return createTerminalModel({ storage, sessions }).load({ server, directory: "/workspace" })
  })

const field = (parent: HTMLElement) => {
  const input = document.createElement("input")
  parent.append(input)

  return input
}

describe("terminal focus requests", () => {
  test("survive the side region focusing its selected tab while switching terminals", () => {
    const side = document.createElement("div")
    side.id = "review-panel"
    document.body.append(side)
    const terminal = workspace()

    terminal.requestFocus("pty_2")
    field(side).focus()

    expect(terminal.focusRequested("pty_2")).toBe(true)
  })

  test("are cancelled when focus leaves the side region", () => {
    const terminal = workspace()

    terminal.requestFocus("pty_2")
    field(document.body).focus()

    expect(terminal.focusRequested("pty_2")).toBe(false)
  })
})
