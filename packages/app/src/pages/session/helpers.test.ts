import { describe, expect, test } from "bun:test"
import {
  createOpenReviewFile,
  createOpenSessionFileTab,
  focusTerminalById,
  getTabReorderIndex,
  interruptedMessageIDs,
} from "./helpers"

describe("createOpenReviewFile", () => {
  test("opens and loads selected review file", () => {
    const calls: string[] = []
    const openReviewFile = createOpenReviewFile({
      showAllFiles: () => calls.push("show"),
      tabForPath: (path) => {
        calls.push(`tab:${path}`)
        return `file://${path}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      loadFile: (path) => calls.push(`load:${path}`),
    })

    openReviewFile("src/a.ts")

    expect(calls).toEqual(["show", "load:src/a.ts", "tab:src/a.ts", "open:file://src/a.ts"])
  })
})

describe("createOpenSessionFileTab", () => {
  test("activates the opened file tab", () => {
    const calls: string[] = []
    const openTab = createOpenSessionFileTab({
      normalizeTab: (value) => {
        calls.push(`normalize:${value}`)
        return `file://${value}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      pathFromTab: (tab) => {
        calls.push(`path:${tab}`)
        return tab.slice("file://".length)
      },
      loadFile: (path) => calls.push(`load:${path}`),
      openReviewPanel: () => calls.push("review"),
      setActive: (tab) => calls.push(`active:${tab}`),
    })

    openTab("src/a.ts")

    expect(calls).toEqual([
      "normalize:src/a.ts",
      "open:file://src/a.ts",
      "path:file://src/a.ts",
      "load:src/a.ts",
      "review",
      "active:file://src/a.ts",
    ])
  })
})

describe("focusTerminalById", () => {
  test("focuses textarea when present", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-one"><div data-component="terminal"><textarea></textarea></div></div>`

    const focused = focusTerminalById("one")

    expect(focused).toBe(true)
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })

  test("falls back to terminal element focus", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-two"><div data-component="terminal" tabindex="0"></div></div>`
    const terminal = document.querySelector('[data-component="terminal"]') as HTMLElement
    let pointerDown = false
    terminal.addEventListener("pointerdown", () => {
      pointerDown = true
    })

    const focused = focusTerminalById("two")

    expect(focused).toBe(true)
    expect(document.activeElement).toBe(terminal)
    expect(pointerDown).toBe(true)
  })
})

describe("getTabReorderIndex", () => {
  test("returns target index for valid drag reorder", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "c")).toBe(2)
  })

  test("returns undefined for unknown droppable id", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "missing")).toBeUndefined()
  })
})

describe("interruptedMessageIDs", () => {
  const user = (id: string, created: number) => ({
    id,
    role: "user" as const,
    time: { created },
  })

  const assistant = (input: {
    id: string
    parentID: string
    created: number
    completed: number
    interrupted?: boolean
  }) => ({
    id: input.id,
    role: "assistant" as const,
    parentID: input.parentID,
    time: { created: input.created, completed: input.completed },
    ...(input.interrupted
      ? {
          error: {
            name: "MessageAbortedError" as const,
          },
        }
      : {}),
  })

  test("marks aborted parent and queued users created during interrupted run", () => {
    const result = interruptedMessageIDs([
      user("u1", 1000),
      assistant({ id: "a1", parentID: "u1", created: 1010, completed: 1100, interrupted: true }),
      user("u2", 1020),
      user("u3", 1080),
    ])

    expect(Array.from(result).sort()).toEqual(["u1", "u2", "u3"])
  })

  test("does not mark users that eventually received assistant replies", () => {
    const result = interruptedMessageIDs([
      user("u1", 1000),
      assistant({ id: "a1", parentID: "u1", created: 1010, completed: 1100, interrupted: true }),
      user("u2", 1020),
      user("u3", 1030),
      assistant({ id: "a2", parentID: "u2", created: 1200, completed: 1300 }),
    ])

    expect(Array.from(result).sort()).toEqual(["u1", "u3"])
  })

  test("handles multiple interrupted runs independently", () => {
    const result = interruptedMessageIDs([
      user("u1", 1000),
      assistant({ id: "a1", parentID: "u1", created: 1010, completed: 1100, interrupted: true }),
      user("u2", 1050),
      user("u3", 1200),
      assistant({ id: "a2", parentID: "u3", created: 1210, completed: 1300, interrupted: true }),
      user("u4", 1220),
      user("u5", 2000),
    ])

    expect(Array.from(result).sort()).toEqual(["u1", "u2", "u3", "u4"])
  })
})
