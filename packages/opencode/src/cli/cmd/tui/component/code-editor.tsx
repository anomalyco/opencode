import { createSignal, createEffect, Show, For, onMount, createMemo, batch } from "solid-js"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { TextAttributes, BoxRenderable, TextareaRenderable } from "@opentui/core"

interface CodeEditorProps {
  filePath: string
  onClose: () => void
  onSave?: (content: string) => void
  readOnly?: boolean
}

export function CodeEditor(props: CodeEditorProps) {
  const { theme, syntax } = useTheme()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()

  // Editor state
  const [lines, setLines] = createSignal<string[]>([])
  const [cursorLine, setCursorLine] = createSignal(0)
  const [cursorCol, setCursorCol] = createSignal(0)
  const [scrollOffset, setScrollOffset] = createSignal(0)
  const [scrollLeft, setScrollLeft] = createSignal(0)
  const [isLoading, setIsLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [isDirty, setIsDirty] = createSignal(false)
  const [mode, setMode] = createSignal<"normal" | "insert" | "visual" | "command">("normal")
  const [commandBuffer, setCommandBuffer] = createSignal("")
  const [message, setMessage] = createSignal("")
  const [visualStart, setVisualStart] = createSignal<{ line: number; col: number } | null>(null)

  // Determine language from file extension
  const getLanguage = () => {
    const ext = props.filePath.split(".").pop()?.toLowerCase() || ""
    const langMap: Record<string, string> = {
      ts: "TypeScript",
      tsx: "TypeScript React",
      js: "JavaScript",
      jsx: "JavaScript React",
      json: "JSON",
      md: "Markdown",
      css: "CSS",
      html: "HTML",
      py: "Python",
      go: "Go",
      rs: "Rust",
      java: "Java",
      sh: "Shell",
      yaml: "YAML",
      yml: "YAML",
    }
    return langMap[ext] || "Text"
  }

  // Load file content
  onMount(async () => {
    try {
      const result = await sdk.client.file.read({ query: { path: props.filePath } })
      if (result.data && result.data.type === "text") {
        const content = result.data.content
        setLines(content.split("\n"))
        setIsLoading(false)
        setMessage("-- NORMAL --")
      } else {
        setError("Unable to read file content")
        setIsLoading(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file")
      setIsLoading(false)
    }
  })

  // Computed values
  const editorHeight = () => dimensions().height - 4 // Reserve space for header and footer
  const editorWidth = () => dimensions().width - 6 // Reserve space for line numbers
  const maxLineNumWidth = () => String(lines().length).length
  const currentLine = () => lines()[cursorLine()] || ""
  const maxScrollOffset = () => Math.max(0, lines().length - editorHeight())

  // Ensure cursor is in valid position
  const normalizeCursor = () => {
    const lineCount = lines().length
    const line = Math.max(0, Math.min(cursorLine(), lineCount - 1))
    const lineLength = lines()[line]?.length || 0
    const col = Math.max(0, Math.min(cursorCol(), mode() === "insert" ? lineLength : Math.max(0, lineLength - 1)))

    if (line !== cursorLine()) setCursorLine(line)
    if (col !== cursorCol()) setCursorCol(col)
  }

  // Auto-scroll to keep cursor visible
  createEffect(() => {
    const line = cursorLine()
    const offset = scrollOffset()
    const height = editorHeight()

    if (line < offset) {
      setScrollOffset(line)
    } else if (line >= offset + height) {
      setScrollOffset(line - height + 1)
    }
  })

  // Auto-scroll horizontally
  createEffect(() => {
    const col = cursorCol()
    const offset = scrollLeft()
    const width = editorWidth()

    if (col < offset) {
      setScrollLeft(col)
    } else if (col >= offset + width) {
      setScrollLeft(col - width + 1)
    }
  })

  // Save file
  const saveFile = async () => {
    if (props.readOnly || !isDirty()) return

    const content = lines().join("\n")

    try {
      // Write file directly using Bun
      await Bun.write(props.filePath, content)
      setIsDirty(false)
      setMessage("File saved successfully")

      // Call onSave callback if provided
      if (props.onSave) {
        props.onSave(content)
      }

      setTimeout(() => setMessage(getModeText()), 2000)
    } catch (err) {
      setMessage(`Save failed: ${err instanceof Error ? err.message : "Unknown error"}`)
      setTimeout(() => setMessage(getModeText()), 3000)
    }
  }

  const getModeText = () => {
    switch (mode()) {
      case "insert":
        return "-- INSERT --"
      case "visual":
        return "-- VISUAL --"
      case "command":
        return ":" + commandBuffer()
      default:
        return "-- NORMAL --"
    }
  }

  const executeCommand = async () => {
    const cmd = commandBuffer().trim()
    setCommandBuffer("")
    setMode("normal")

    if (cmd === "w" || cmd === "write") {
      await saveFile()
    } else if (cmd === "q" || cmd === "quit") {
      if (isDirty()) {
        setMessage("No write since last change (add ! to override)")
        setTimeout(() => setMessage(getModeText()), 2000)
      } else {
        props.onClose()
      }
    } else if (cmd === "q!" || cmd === "quit!") {
      props.onClose()
    } else if (cmd === "wq" || cmd === "x") {
      await saveFile()
      if (!isDirty()) {
        props.onClose()
      }
    } else {
      setMessage(`Unknown command: ${cmd}`)
      setTimeout(() => setMessage(getModeText()), 2000)
    }
  }

  // Insert mode: type characters
  const insertChar = (char: string) => {
    if (props.readOnly) return

    const newLines = [...lines()]
    const line = cursorLine()
    const col = cursorCol()
    const currentLine = newLines[line] || ""

    newLines[line] = currentLine.slice(0, col) + char + currentLine.slice(col)
    setLines(newLines)
    setCursorCol(col + char.length)
    setIsDirty(true)
  }

  // Delete character at cursor
  const deleteChar = () => {
    if (props.readOnly) return

    const newLines = [...lines()]
    const line = cursorLine()
    const col = cursorCol()
    const currentLine = newLines[line] || ""

    if (col === 0 && line > 0) {
      // Backspace at start of line - join with previous
      const prevLine = newLines[line - 1]
      newLines[line - 1] = prevLine + currentLine
      newLines.splice(line, 1)
      setCursorLine(line - 1)
      setCursorCol(prevLine.length)
    } else if (col > 0) {
      // Delete character before cursor
      newLines[line] = currentLine.slice(0, col - 1) + currentLine.slice(col)
      setCursorCol(col - 1)
    }

    setLines(newLines)
    setIsDirty(true)
  }

  // Delete character under cursor (delete key)
  const deleteCharForward = () => {
    if (props.readOnly) return

    const newLines = [...lines()]
    const line = cursorLine()
    const col = cursorCol()
    const currentLine = newLines[line] || ""

    if (col >= currentLine.length && line < newLines.length - 1) {
      // At end of line - join with next
      newLines[line] = currentLine + newLines[line + 1]
      newLines.splice(line + 1, 1)
    } else if (col < currentLine.length) {
      newLines[line] = currentLine.slice(0, col) + currentLine.slice(col + 1)
    }

    setLines(newLines)
    setIsDirty(true)
  }

  // Insert new line
  const insertNewLine = () => {
    if (props.readOnly) return

    const newLines = [...lines()]
    const line = cursorLine()
    const col = cursorCol()
    const currentLine = newLines[line] || ""

    // Split current line at cursor
    const before = currentLine.slice(0, col)
    const after = currentLine.slice(col)

    newLines[line] = before
    newLines.splice(line + 1, 0, after)

    setLines(newLines)
    setCursorLine(line + 1)
    setCursorCol(0)
    setIsDirty(true)
  }

  // Delete entire line
  const deleteLine = () => {
    if (props.readOnly) return

    const newLines = [...lines()]
    if (newLines.length === 1) {
      newLines[0] = ""
    } else {
      newLines.splice(cursorLine(), 1)
      if (cursorLine() >= newLines.length) {
        setCursorLine(newLines.length - 1)
      }
    }
    setLines(newLines)
    setCursorCol(0)
    setIsDirty(true)
  }

  // Vim-style keyboard handling
  useKeyboard((evt) => {
    // CRITICAL: Prevent all keys from passing through to components behind dialog
    evt.preventDefault()

    normalizeCursor()

    // ESC - always goes to normal mode or closes
    if (evt.name === "escape") {
      if (mode() === "normal") {
        props.onClose()
      } else {
        setMode("normal")
        setMessage("-- NORMAL --")
        setVisualStart(null)
        // Move cursor back one if at end of line
        if (cursorCol() > 0 && cursorCol() >= currentLine().length) {
          setCursorCol(cursorCol() - 1)
        }
      }
      return
    }

    const currentMode = mode()

    // ============ NORMAL MODE ============
    if (currentMode === "normal") {
      // Movement
      if (evt.name === "h" || evt.name === "left") {
        setCursorCol(Math.max(0, cursorCol() - 1))
      } else if (evt.name === "l" || evt.name === "right") {
        setCursorCol(Math.min(currentLine().length - 1, cursorCol() + 1))
      } else if (evt.name === "j" || evt.name === "down") {
        setCursorLine(Math.min(lines().length - 1, cursorLine() + 1))
      } else if (evt.name === "k" || evt.name === "up") {
        setCursorLine(Math.max(0, cursorLine() - 1))
      }
      // Word movement
      else if (evt.name === "w") {
        // Jump to next word
        const line = currentLine()
        let col = cursorCol()
        // Skip current word
        while (col < line.length && /\w/.test(line[col])) col++
        // Skip whitespace
        while (col < line.length && /\s/.test(line[col])) col++
        setCursorCol(col)
      } else if (evt.name === "b") {
        // Jump to previous word
        const line = currentLine()
        let col = cursorCol()
        if (col > 0) col--
        // Skip whitespace
        while (col > 0 && /\s/.test(line[col])) col--
        // Skip word
        while (col > 0 && /\w/.test(line[col])) col--
        if (col > 0) col++
        setCursorCol(col)
      }
      // Line navigation
      else if (evt.name === "0" || evt.name === "home") {
        setCursorCol(0)
      } else if (evt.name === "$" || evt.name === "end") {
        setCursorCol(Math.max(0, currentLine().length - 1))
      } else if (evt.name === "g" && evt.name === "g") {
        setCursorLine(0)
        setCursorCol(0)
      } else if (evt.name === "G") {
        setCursorLine(lines().length - 1)
        setCursorCol(0)
      }
      // Page navigation
      else if (evt.ctrl && evt.name === "d") {
        setCursorLine(Math.min(lines().length - 1, cursorLine() + Math.floor(editorHeight() / 2)))
      } else if (evt.ctrl && evt.name === "u") {
        setCursorLine(Math.max(0, cursorLine() - Math.floor(editorHeight() / 2)))
      } else if ((evt.ctrl && evt.name === "f") || evt.name === "pagedown") {
        setCursorLine(Math.min(lines().length - 1, cursorLine() + editorHeight()))
      } else if ((evt.ctrl && evt.name === "b") || evt.name === "pageup") {
        setCursorLine(Math.max(0, cursorLine() - editorHeight()))
      }
      // Enter insert mode
      else if (evt.name === "i") {
        if (!props.readOnly) {
          setMode("insert")
          setMessage("-- INSERT --")
        }
      } else if (evt.name === "I") {
        if (!props.readOnly) {
          setCursorCol(0)
          setMode("insert")
          setMessage("-- INSERT --")
        }
      } else if (evt.name === "a") {
        if (!props.readOnly) {
          setCursorCol(Math.min(currentLine().length, cursorCol() + 1))
          setMode("insert")
          setMessage("-- INSERT --")
        }
      } else if (evt.name === "A") {
        if (!props.readOnly) {
          setCursorCol(currentLine().length)
          setMode("insert")
          setMessage("-- INSERT --")
        }
      } else if (evt.name === "o") {
        if (!props.readOnly) {
          const newLines = [...lines()]
          newLines.splice(cursorLine() + 1, 0, "")
          setLines(newLines)
          setCursorLine(cursorLine() + 1)
          setCursorCol(0)
          setMode("insert")
          setMessage("-- INSERT --")
          setIsDirty(true)
        }
      } else if (evt.name === "O") {
        if (!props.readOnly) {
          const newLines = [...lines()]
          newLines.splice(cursorLine(), 0, "")
          setLines(newLines)
          setCursorCol(0)
          setMode("insert")
          setMessage("-- INSERT --")
          setIsDirty(true)
        }
      }
      // Delete operations
      else if (evt.name === "x") {
        deleteCharForward()
      } else if (evt.name === "X") {
        deleteChar()
      } else if (evt.name === "d" && evt.name === "d") {
        deleteLine()
      }
      // Visual mode
      else if (evt.name === "v") {
        setMode("visual")
        setVisualStart({ line: cursorLine(), col: cursorCol() })
        setMessage("-- VISUAL --")
      }
      // Command mode
      else if (evt.name === ":") {
        setMode("command")
        setCommandBuffer("")
        setMessage(":")
      }
    }
    // ============ INSERT MODE ============
    else if (currentMode === "insert") {
      if (evt.name === "return") {
        insertNewLine()
      } else if (evt.name === "backspace") {
        deleteChar()
      } else if (evt.name === "delete") {
        deleteCharForward()
      } else if (evt.name === "left") {
        setCursorCol(Math.max(0, cursorCol() - 1))
      } else if (evt.name === "right") {
        setCursorCol(Math.min(currentLine().length, cursorCol() + 1))
      } else if (evt.name === "up") {
        setCursorLine(Math.max(0, cursorLine() - 1))
      } else if (evt.name === "down") {
        setCursorLine(Math.min(lines().length - 1, cursorLine() + 1))
      } else if (evt.name === "tab") {
        insertChar("  ") // 2 spaces
      } else if (evt.sequence && evt.sequence.length === 1 && !evt.ctrl && !evt.meta) {
        insertChar(evt.sequence)
      }
    }
    // ============ VISUAL MODE ============
    else if (currentMode === "visual") {
      // Same movement as normal mode
      if (evt.name === "h" || evt.name === "left") {
        setCursorCol(Math.max(0, cursorCol() - 1))
      } else if (evt.name === "l" || evt.name === "right") {
        setCursorCol(Math.min(currentLine().length, cursorCol() + 1))
      } else if (evt.name === "j" || evt.name === "down") {
        setCursorLine(Math.min(lines().length - 1, cursorLine() + 1))
      } else if (evt.name === "k" || evt.name === "up") {
        setCursorLine(Math.max(0, cursorLine() - 1))
      }
      // Exit visual
      else if (evt.name === "escape") {
        setMode("normal")
        setVisualStart(null)
        setMessage("-- NORMAL --")
      }
    }
    // ============ COMMAND MODE ============
    else if (currentMode === "command") {
      if (evt.name === "return") {
        executeCommand()
      } else if (evt.name === "backspace") {
        if (commandBuffer().length > 0) {
          setCommandBuffer(commandBuffer().slice(0, -1))
        } else {
          setMode("normal")
          setMessage("-- NORMAL --")
        }
      } else if (evt.sequence && evt.sequence.length === 1 && !evt.ctrl && !evt.meta) {
        setCommandBuffer(commandBuffer() + evt.sequence)
      }
    }
  })

  // Syntax highlighting helper
  const getLineColor = (line: string, lang: string) => {
    if (
      lang.includes("JavaScript") ||
      lang.includes("TypeScript") ||
      lang === "Go" ||
      lang === "Rust" ||
      lang === "Python"
    ) {
      if (/^\s*(const|let|var|function|class|if|else|for|while|return|import|export|from|async|await)\s/.test(line)) {
        return theme.primary
      }
      if (/^\s*(\/\/|#)/.test(line)) {
        return theme.textMuted
      }
      if (/"[^"]*"|'[^']*'|`[^`]*`/.test(line)) {
        return theme.success
      }
    }
    return theme.text
  }

  const fileName = () => props.filePath.split("/").pop() || props.filePath

  // Visible lines based on scroll
  const visibleLines = () => {
    const start = scrollOffset()
    const end = start + editorHeight()
    return lines()
      .slice(start, end)
      .map((line, idx) => ({
        lineNumber: start + idx + 1,
        content: line,
        isCursor: start + idx === cursorLine(),
      }))
  }

  // Centered dialog calculations
  const dialogWidth = () => Math.min(Math.floor(dimensions().width * 0.8), 120)
  const dialogHeight = () => Math.min(Math.floor(dimensions().height * 0.8), 40)
  const dialogX = () => Math.floor((dimensions().width - dialogWidth()) / 2)
  const dialogY = () => Math.floor((dimensions().height - dialogHeight()) / 2)

  return (
    <box width={dimensions().width} height={dimensions().height}>
      {/* Backdrop */}
      <box
        position="absolute"
        top={0}
        left={0}
        width={dimensions().width}
        height={dimensions().height}
        backgroundColor={theme.background}
      />

      {/* Centered Dialog */}
      <box
        position="absolute"
        top={dialogY()}
        left={dialogX()}
        width={dialogWidth()}
        height={dialogHeight()}
        flexDirection="column"
        backgroundColor={theme.background}
        borderStyle="rounded"
        borderColor={theme.border}
      >
        {/* Header */}
        <box height={1} backgroundColor={theme.backgroundPanel} flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {fileName()}
            </text>
            <text fg={theme.textMuted}>({getLanguage()})</text>
            {isDirty() && <text fg={theme.warning}>[+]</text>}
            {props.readOnly && <text fg={theme.textMuted}>[RO]</text>}
          </box>
          <box paddingRight={1}>
            <text fg={theme.textMuted}>{lines().length} lines</text>
          </box>
        </box>

        {/* Editor area */}
        <box flexGrow={1} flexDirection="column" backgroundColor={theme.background}>
          <Show when={isLoading()}>
            <box flexGrow={1} justifyContent="center" alignItems="center">
              <text fg={theme.textMuted}>Loading...</text>
            </box>
          </Show>

          <Show when={error()}>
            <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" gap={1}>
              <text fg={theme.error} attributes={TextAttributes.BOLD}>
                Error: {error()}
              </text>
            </box>
          </Show>

          <Show when={!isLoading() && !error()}>
            <box flexDirection="column">
              <For each={visibleLines()}>
                {(line) => {
                  const lineNumWidth = maxLineNumWidth()
                  const lineNum = String(line.lineNumber).padStart(lineNumWidth, " ")
                  const isCursorLine = line.isCursor

                  return (
                    <box flexDirection="row" backgroundColor={isCursorLine ? theme.backgroundElement : undefined}>
                      {/* Line number */}
                      <text fg={theme.textMuted} flexShrink={0} paddingRight={1}>
                        {lineNum}
                      </text>

                      {/* Line content */}
                      <text fg={getLineColor(line.content, getLanguage())} wrapMode="none">
                        {line.content || " "}
                      </text>

                      {/* Cursor indicator */}
                      {isCursorLine && (
                        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                          {" "}
                          ←
                        </text>
                      )}
                    </box>
                  )
                }}
              </For>
            </box>
          </Show>
        </box>

        {/* Status bar */}
        <box
          height={1}
          backgroundColor={theme.backgroundPanel}
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.text}>{message()}</text>
          <text fg={theme.textMuted}>
            {cursorLine() + 1}:{cursorCol() + 1}
          </text>
        </box>

        {/* Help footer */}
        <box height={1} backgroundColor={theme.backgroundElement} paddingLeft={1} flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>ESC:exit</text>
          <text fg={theme.textMuted}>i:insert</text>
          <text fg={theme.textMuted}>v:visual</text>
          <text fg={theme.textMuted}>:w:save</text>
          <text fg={theme.textMuted}>hjkl:move</text>
        </box>
      </box>
    </box>
  )
}
