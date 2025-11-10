import type { Component } from "solid-js"
import { createSignal, onMount, onCleanup, createEffect } from "solid-js"
import { TerminalGrid } from "../terminal/TerminalGrid"
import { TerminalBuffer } from "../terminal/buffer"
import type { TerminalCell } from "../terminal/types"
import { Colors } from "../terminal/types"
import { drawSeparator, drawContextBar } from "../terminal/utils"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"

export const TerminalView: Component = () => {
  const sync = useSync()
  const sdk = useSDK()

  // Calculate dimensions based on viewport
  const calculateDims = () => {
    const charWidth = 9.6
    const charHeight = 24
    const cols = Math.floor(window.innerWidth / charWidth)
    const rows = Math.floor(window.innerHeight / charHeight)
    return { cols, rows }
  }

  const [dims, setDims] = createSignal(calculateDims())
  const [grid, setGrid] = createSignal<TerminalCell[][]>([])
  const [selectedSessionID, setSelectedSessionID] = createSignal<string | null>(null)
  const [inputText, setInputText] = createSignal("")

  const drawTerminal = () => {
    const { cols, rows } = dims()

    // Layout regions
    const SESSION_LIST_START = 0
    const SESSION_LIST_WIDTH = 40
    const MESSAGE_START = 40
    const MESSAGE_WIDTH = cols - 80
    const SIDEBAR_START = cols - 40
    const SIDEBAR_WIDTH = 40
    const BOTTOM_BAR_ROW = rows - 1

    const buf = new TerminalBuffer(cols, rows)

    // Clear everything
    buf.fillRect(0, 0, cols, rows, {
      char: " ",
      bg: Colors.BG_MAIN,
      fg: Colors.TEXT_MAIN,
    })

    // === LEFT PANEL: SESSION LIST ===
    buf.fillRect(SESSION_LIST_START, 0, SESSION_LIST_WIDTH, rows - 1, {
      char: " ",
      bg: Colors.BG_PANEL,
    })

    buf.writeString(SESSION_LIST_START + 2, 1, "Sessions", {
      fg: Colors.TEXT_BRIGHT,
      bg: Colors.BG_PANEL,
      bold: true,
    })

    buf.writeString(SESSION_LIST_START + 2, 3, "[Search...]", {
      fg: Colors.TEXT_MUTED,
      bg: Colors.BG_INPUT,
    })

    // Render real sessions from sync data
    const sessions = sync.data.session
      .filter((s) => !s.parentID)
      .sort((a, b) => b.time.updated - a.time.updated)
      .slice(0, 20)

    let sessionRow = 5
    sessions.forEach((session, idx) => {
      const isSelected = selectedSessionID() === session.id
      const marker = isSelected ? "*" : "o"
      const color = isSelected ? Colors.SYNTAX_CYAN : Colors.TEXT_MUTED
      const title = session.title.slice(0, SESSION_LIST_WIDTH - 4)
      const msgCount = sync.data.message[session.id]?.length || 0

      buf.writeString(SESSION_LIST_START + 2, sessionRow, `${marker} ${title}`, {
        fg: color,
        bg: Colors.BG_PANEL,
      })
      buf.writeString(SESSION_LIST_START + 2, sessionRow + 1, `  ${msgCount} messages`, {
        fg: Colors.TEXT_DIM,
        bg: Colors.BG_PANEL,
      })

      sessionRow += 3
      if (sessionRow > rows - 10) return
    })

    // Vertical separator
    for (let row = 0; row < rows - 1; row++) {
      buf.writeChar(SESSION_LIST_WIDTH - 1, row, {
        char: " ",
        bg: Colors.BORDER,
      })
    }

    // === CENTER PANEL: MESSAGES ===
    buf.writeString(MESSAGE_START + 2, 1, "<- Back", {
      fg: Colors.TEXT_MUTED,
      bg: Colors.BG_MAIN,
    })
    buf.writeString(MESSAGE_START + 50, 1, "Terminal Grid Demo", {
      fg: Colors.TEXT_BRIGHT,
      bg: Colors.BG_MAIN,
    })

    // Render real messages if session selected
    if (selectedSessionID()) {
      const messages = sync.data.message[selectedSessionID()!] || []
      let msgRow = 5

      messages.slice(-10).forEach((msg) => {
        const parts = sync.data.part[msg.id] || []

        // Render message content
        parts.forEach((part) => {
          if (part.type === "text") {
            const text = part.text.slice(0, MESSAGE_WIDTH - 4)
            buf.writeString(MESSAGE_START + 2, msgRow, text, {
              fg: "#ffffff",
              bg: Colors.BG_MAIN,
            })
            msgRow++
          }
        })

        // Render username and status
        const username = msg.role === "user" ? "jkneen" : "Assistant"
        const color = msg.role === "user" ? Colors.SYNTAX_YELLOW : Colors.SYNTAX_CYAN
        buf.writeString(MESSAGE_START + 2, msgRow, username, {
          fg: color,
          bg: Colors.BG_MAIN,
        })

        msgRow += 2
        if (msgRow > inputRow - 5) return
      })
    }

    // Input prompt
    const inputRow = rows - 2
    buf.writeString(MESSAGE_START + 2, inputRow, "> ", {
      fg: Colors.ACCENT_YELLOW,
      bg: Colors.BG_MAIN,
    })
    buf.writeChar(MESSAGE_START + 4, inputRow, {
      char: " ",
      bg: Colors.ACCENT_YELLOW,
    })

    // Vertical separator
    for (let row = 0; row < rows - 1; row++) {
      buf.writeChar(SIDEBAR_START - 1, row, {
        char: " ",
        bg: Colors.BORDER,
      })
    }

    // === RIGHT PANEL: SIDEBAR ===
    buf.fillRect(SIDEBAR_START, 0, SIDEBAR_WIDTH, rows - 1, {
      char: " ",
      bg: Colors.BG_PANEL,
    })

    buf.writeString(SIDEBAR_START + SIDEBAR_WIDTH - 10, 0, "CODESURF", {
      fg: "#666666",
      bg: Colors.BG_PANEL,
      bold: true,
    })

    buf.writeString(SIDEBAR_START + 2, 1, "Terminal Grid Demo", {
      fg: "#ffffff",
      bg: Colors.BG_PANEL,
    })

    buf.writeString(SIDEBAR_START + 2, 3, "Context", {
      fg: "#ffffff",
      bg: Colors.BG_PANEL,
      bold: true,
    })

    drawContextBar(buf, 4, SIDEBAR_START + 2, 30, [
      { width: 15, color: "#ce9178" },
      { width: 10, color: "#666666" },
    ])

    buf.writeString(SIDEBAR_START + 33, 4, "72%", {
      fg: "#ffffff",
      bg: Colors.BG_PANEL,
    })

    buf.writeString(SIDEBAR_START + 2, 5, "143,429 tokens (99% cached)", {
      fg: "#666666",
      bg: Colors.BG_PANEL,
    })
    buf.writeString(SIDEBAR_START + 2, 6, "$0.00 spent", {
      fg: "#666666",
      bg: Colors.BG_PANEL,
    })

    buf.writeString(SIDEBAR_START + 2, 8, "* Tools(4)", {
      fg: Colors.ACCENT_CYAN,
      bg: Colors.BG_PANEL,
    })
    buf.writeString(SIDEBAR_START + 14, 8, "o Todos(0)", {
      fg: "#666666",
      bg: Colors.BG_PANEL,
    })
    buf.writeString(SIDEBAR_START + 26, 8, "o Files(7)", {
      fg: "#666666",
      bg: Colors.BG_PANEL,
    })

    drawSeparator(buf, 9, SIDEBAR_START, SIDEBAR_WIDTH, Colors.BORDER)

    buf.writeString(SIDEBAR_START + 2, 10, "> Tools Used (4)", {
      fg: "#ffffff",
      bg: Colors.BG_PANEL,
    })
    buf.writeString(SIDEBAR_START + 4, 11, "CC_READ", {
      fg: Colors.ACCENT_CYAN,
      bg: "#252525",
    })
    buf.writeString(SIDEBAR_START + 4, 12, "CC_WRITE", {
      fg: Colors.ACCENT_CYAN,
      bg: "#252525",
    })
    buf.writeString(SIDEBAR_START + 4, 13, "CC_BASH", {
      fg: Colors.ACCENT_CYAN,
      bg: "#252525",
    })
    buf.writeString(SIDEBAR_START + 4, 14, "EDIT", {
      fg: Colors.ACCENT_CYAN,
      bg: "#252525",
    })

    // Subagents section
    buf.writeString(SIDEBAR_START + 2, 17, "v Subagents (2)", {
      fg: "#ffffff",
      bg: Colors.BG_PANEL,
    })
    buf.writeString(SIDEBAR_START + 4, 18, "* code-reviewer", {
      fg: Colors.ACCENT_CYAN,
      bg: "#252525",
    })
    buf.writeString(SIDEBAR_START + 4, 19, "o git-committer", {
      fg: "#666666",
      bg: "#252525",
    })

    // === BOTTOM BAR ===
    buf.fillRect(0, BOTTOM_BAR_ROW, cols, 1, {
      char: " ",
      bg: Colors.BG_PANEL,
    })

    buf.writeString(2, BOTTOM_BAR_ROW, "Anthropic ", {
      fg: "#ffffff",
      bg: Colors.BG_PANEL,
    })
    buf.writeString(12, BOTTOM_BAR_ROW, "Claude Sonnet 4.5 (latest)", {
      fg: "#ffffff",
      bg: Colors.BG_PANEL,
      underline: true,
    })

    buf.writeString(cols - 20, BOTTOM_BAR_ROW, "tab", {
      fg: "#666666",
      bg: Colors.BG_PANEL,
    })
    buf.writeString(cols - 16, BOTTOM_BAR_ROW, "BUILD", {
      fg: "#ffffff",
      bg: "#3e3e3e",
    })
    buf.writeString(cols - 14, BOTTOM_BAR_ROW, "esc", {
      fg: "#ffffff",
      bg: Colors.BG_PANEL,
      bold: true,
    })
    buf.writeString(cols - 10, BOTTOM_BAR_ROW, " interrupt", {
      fg: "#666666",
      bg: Colors.BG_PANEL,
    })

    setGrid(buf.getGrid())
  }

  onMount(() => {
    drawTerminal()

    const handleResize = () => {
      setDims(calculateDims())
      drawTerminal()
    }

    window.addEventListener("resize", handleResize)
    onCleanup(() => window.removeEventListener("resize", handleResize))
  })

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        "align-items": "flex-start",
        "justify-content": "flex-start",
        background: "#0a0a0a",
        overflow: "hidden",
      }}
    >
      <TerminalGrid grid={grid()} cols={dims().cols} rows={dims().rows} />
    </div>
  )
}
