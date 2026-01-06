import { createSignal } from "solid-js"
import type { TextareaRenderable, LineNumberRenderable } from "@opentui/core"
import { Clipboard } from "../util/clipboard"

export type ViBasicState = "normal" | "insert"
export type ViBasicType = "full" | "prompt"

export interface ViBasicOptions {
  textarea: () => TextareaRenderable | undefined
  onContentChange?: () => void
  mode?: ViBasicType
  /** Copy single char deletes (x) to clipboard. Default: false */
  clipX?: boolean
  /** Optional LineNumberRenderable to force gutter redraw on content changes */
  lineNumbers?: () => LineNumberRenderable | undefined
}

interface KeyEvent {
  name?: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  sequence?: string
  preventDefault: () => void
}

export interface ViBasicResult {
  state: () => ViBasicState
  command: () => string
  yank: () => string
  replaceMode: () => boolean
  handleKey: (evt: KeyEvent) => boolean
  reset: () => void
  // Search state
  searchMode: () => boolean
  searchBuffer: () => string
  searchPattern: () => string
}

const MODE_CONFIG: Record<
  ViBasicType,
  {
    startInsert: boolean
    moveCursorOnEscape: boolean
    passInsert: string[]
  }
> = {
  full: {
    startInsert: false,
    moveCursorOnEscape: true,
    passInsert: [],
  },
  prompt: {
    startInsert: true,
    moveCursorOnEscape: false,
    passInsert: [],
  },
}

export function useViBasic(options: ViBasicOptions): ViBasicResult {
  const mode: ViBasicType = options.mode ?? "full"
  const config = MODE_CONFIG[mode]

  const [state, setState] = createSignal<ViBasicState>(config.startInsert ? "insert" : "normal")
  const [command, setCommand] = createSignal("")
  const [yankReg, setYankReg] = createSignal("")
  const [lastAction, setLastAction] = createSignal<(() => void) | null>(null)
  const [replaceMode, setReplaceMode] = createSignal(false)
  // Search state
  const [searchMode, setSearchMode] = createSignal(false)
  const [searchBuffer, setSearchBuffer] = createSignal("")
  const [searchPattern, setSearchPattern] = createSignal("")
  const [searchDirection, setSearchDirection] = createSignal<"forward" | "backward">("forward")
  const [searchOperator, setSearchOperator] = createSignal<"d" | "c" | "y" | null>(null)

  const setYank = (text: string) => {
    setYankReg(text)
    Clipboard.copy(text)
  }

  const handleKey = (evt: KeyEvent): boolean => {
    const textarea = options.textarea()
    if (!textarea) return false

    // Pass through ctrl keys in prompt mode (except f/b/r)
    if (mode === "prompt" && evt.ctrl && evt.name !== "f" && evt.name !== "b" && evt.name !== "r") {
      return false
    }

    const key = evt.shift && evt.name?.length === 1 ? evt.name.toUpperCase() : evt.name || ""

    // Helper to mark event as handled
    const handled = () => {
      evt.preventDefault()
      return true
    }

    // Search: find next/prev match and move cursor (defined early for search mode)
    const findMatch = (pattern: string, direction: "forward" | "backward"): boolean => {
      if (!pattern) return false
      const text = textarea.plainText
      const offset = textarea.cursorOffset

      // Try to compile as regex, fall back to literal if invalid
      let regex: RegExp
      try {
        regex = new RegExp(pattern, "g")
      } catch {
        // Invalid regex, escape special chars and use as literal
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        regex = new RegExp(escaped, "g")
      }

      if (direction === "forward") {
        // Search from cursor+1 to end, then wrap to beginning
        const afterCursor = text.slice(offset + 1)
        const match = regex.exec(afterCursor)
        if (match) {
          textarea.cursorOffset = offset + 1 + match.index
          textarea.requestRender()
          return true
        }
        // Wrap around - search from beginning
        regex.lastIndex = 0
        const wrapMatch = regex.exec(text.slice(0, offset))
        if (wrapMatch) {
          textarea.cursorOffset = wrapMatch.index
          textarea.requestRender()
          return true
        }
      } else {
        // Search backward: find all matches before cursor, take last one
        const beforeCursor = text.slice(0, offset)
        let lastMatch: RegExpExecArray | null = null
        let match: RegExpExecArray | null
        regex.lastIndex = 0
        while ((match = regex.exec(beforeCursor)) !== null) {
          lastMatch = match
        }
        if (lastMatch) {
          textarea.cursorOffset = lastMatch.index
          textarea.requestRender()
          return true
        }
        // Wrap around - find all matches after cursor, take last one
        const afterCursor = text.slice(offset + 1)
        lastMatch = null
        regex.lastIndex = 0
        while ((match = regex.exec(afterCursor)) !== null) {
          lastMatch = match
        }
        if (lastMatch) {
          textarea.cursorOffset = offset + 1 + lastMatch.index
          textarea.requestRender()
          return true
        }
      }
      return false
    }

    // Search: find match and return offset (for operator motions)
    const findMatchOffset = (pattern: string, direction: "forward" | "backward"): number | null => {
      if (!pattern) return null
      const text = textarea.plainText
      const offset = textarea.cursorOffset

      let regex: RegExp
      try {
        regex = new RegExp(pattern, "g")
      } catch {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        regex = new RegExp(escaped, "g")
      }

      if (direction === "forward") {
        const afterCursor = text.slice(offset + 1)
        const match = regex.exec(afterCursor)
        if (match) return offset + 1 + match.index
        regex.lastIndex = 0
        const wrapMatch = regex.exec(text.slice(0, offset))
        if (wrapMatch) return wrapMatch.index
      } else {
        const beforeCursor = text.slice(0, offset)
        let lastMatch: RegExpExecArray | null = null
        let match: RegExpExecArray | null
        regex.lastIndex = 0
        while ((match = regex.exec(beforeCursor)) !== null) {
          lastMatch = match
        }
        if (lastMatch) return lastMatch.index
        const afterCursor = text.slice(offset + 1)
        lastMatch = null
        regex.lastIndex = 0
        while ((match = regex.exec(afterCursor)) !== null) {
          lastMatch = match
        }
        if (lastMatch) return offset + 1 + lastMatch.index
      }
      return null
    }

    // Helpers
    const lines = () => textarea.plainText.split("\n")
    const cursor = () => textarea.editorView.getCursor()
    const lineLen = (row: number) => lines()[row]?.length || 0
    const maxCol = (row: number) => Math.max(0, lineLen(row) - 1)

    const setCursor = (row: number, col: number, clamp = true) => {
      const ls = lines()
      const r = Math.max(0, Math.min(row, ls.length - 1))
      const max = clamp ? maxCol(r) : lineLen(r)
      const c = Math.max(0, Math.min(col, max))
      textarea.editBuffer.setCursor(r, c)
      textarea.requestRender()
    }

    const clamp = () => {
      const c = cursor()
      const max = maxCol(c.row)
      if (c.col > max) setCursor(c.row, max)
    }

    // Notify content change and force gutter redraw
    const contentChanged = () => {
      // Force gutter redraw by re-setting line numbers (workaround for opentui bug)
      // The gutter's handleLineInfoChange only calls remeasure(), not requestRender()
      const ln = options.lineNumbers?.()
      if (ln) ln.setLineNumbers(ln.getLineNumbers())
      textarea.requestRender()
      options.onContentChange?.()
    }

    const yankLines = (count: number) => {
      const ls = lines()
      const c = cursor()
      const yanked = ls.slice(c.row, c.row + count).join("\n") + "\n"
      setYank(yanked)
      return yanked
    }

    const deleteLines = (count: number) => {
      yankLines(count)
      const ls = lines()
      const c = cursor()
      const startRow = c.row
      const endRow = Math.min(c.row + count, ls.length)
      if (endRow >= ls.length) {
        const lastLen = ls[ls.length - 1]?.length || 0
        if (startRow > 0) {
          const prevLen = ls[startRow - 1]?.length || 0
          textarea.deleteRange(startRow - 1, prevLen, ls.length - 1, lastLen)
        }
        if (startRow === 0) {
          textarea.deleteRange(0, 0, ls.length - 1, lastLen)
        }
      }
      if (endRow < ls.length) {
        textarea.deleteRange(startRow, 0, endRow, 0)
      }
      textarea.requestRender()
      contentChanged()
    }

    const repeat = (n: number, fn: () => void) => {
      for (let i = 0; i < n; i++) fn()
    }

    const enterInsert = (_reason: string) => {
      setState("insert")
    }

    // Search mode handling (only for full mode, not prompt)
    if (searchMode() && mode === "full") {
      if (key === "escape") {
        setSearchMode(false)
        setSearchBuffer("")
        setSearchOperator(null)
        setSearchPattern("")
        return handled()
      }
      if (key === "return") {
        // Use buffer if typed, otherwise use previous pattern
        const pattern = searchBuffer() || searchPattern()
        const op = searchOperator()
        if (pattern) {
          setSearchPattern(pattern)
          const matchOffset = findMatchOffset(pattern, searchDirection())
          if (matchOffset !== null && op) {
            // Operator pending - delete/change/yank from cursor to match
            const startOffset = textarea.cursorOffset
            const endOffset = matchOffset
            if (startOffset !== endOffset) {
              const text = textarea.plainText
              const from = Math.min(startOffset, endOffset)
              const to = Math.max(startOffset, endOffset)
              const yanked = text.slice(from, to)
              setYank(yanked)
              if (op === "d" || op === "c") {
                // Delete the range as single operation for proper undo
                const fromPos = textarea.editBuffer.offsetToPosition(from)
                const toPos = textarea.editBuffer.offsetToPosition(to)
                if (fromPos && toPos) {
                  textarea.deleteRange(fromPos.row, fromPos.col, toPos.row, toPos.col)
                }
                textarea.cursorOffset = from
                contentChanged()
                if (op === "c") {
                  enterInsert("c/<pattern>")
                }
              }
            }
          } else if (matchOffset !== null) {
            // No operator - just move cursor
            textarea.cursorOffset = matchOffset
            textarea.requestRender()
          }
        }
        setSearchMode(false)
        setSearchBuffer("")
        setSearchOperator(null)
        return handled()
      }
      if (key === "backspace") {
        setSearchBuffer(searchBuffer().slice(0, -1))
        return handled()
      }
      // Regular character input
      if (key.length === 1 && !evt.ctrl && !evt.meta) {
        setSearchBuffer(searchBuffer() + key)
        return handled()
      }
      return handled()
    }

    const deleteWords = (count: number) => {
      const c = cursor()
      const startOffset = textarea.cursorOffset
      for (let i = 0; i < count; i++) textarea.moveWordForward()
      const endOffset = textarea.cursorOffset
      const text = textarea.getTextRange(startOffset, endOffset)
      setYank(text)
      textarea.editBuffer.setCursor(c.row, c.col)
      for (let i = 0; i < count; i++) textarea.deleteWordForward()
      contentChanged()
    }

    const deleteToLine = (targetLine: number) => {
      const c = cursor()
      const ls = lines()
      const startRow = Math.min(c.row, targetLine)
      const endRow = Math.max(c.row, targetLine)
      const yanked = ls.slice(startRow, endRow + 1).join("\n") + "\n"
      setYank(yanked)
      if (endRow >= ls.length - 1) {
        const lastLen = ls[ls.length - 1]?.length || 0
        if (startRow > 0) {
          const prevLen = ls[startRow - 1]?.length || 0
          textarea.deleteRange(startRow - 1, prevLen, ls.length - 1, lastLen)
        }
        if (startRow === 0) {
          textarea.deleteRange(0, 0, ls.length - 1, lastLen)
        }
      }
      if (endRow < ls.length - 1) {
        textarea.deleteRange(startRow, 0, endRow + 1, 0)
      }
      textarea.requestRender()
      setCursor(startRow, 0)
      contentChanged()
    }

    // INSERT MODE
    if (state() === "insert") {
      if (key === "escape") {
        setState("normal")
        if (config.moveCursorOnEscape) textarea.moveCursorLeft()
        return handled()
      }
      if (key === "return") {
        if (mode === "prompt") return false
        textarea.insertText("\n")
        contentChanged()
        return handled()
      }
      if (key === "linefeed") {
        textarea.insertText("\n")
        contentChanged()
        return handled()
      }
      // Arrow keys - pass through to native textarea handling
      if (key === "left" || key === "right" || key === "up" || key === "down") {
        return false
      }
      if (config.passInsert.includes(key)) return false
      if (key === "space") {
        textarea.insertText(" ")
        contentChanged()
        return handled()
      }
      if (key === "backspace") {
        textarea.deleteCharBackward()
        contentChanged()
        return handled()
      }
      if (key.length === 1 && !evt.ctrl && !evt.meta) {
        textarea.insertText(key)
        contentChanged()
        return handled()
      }
      if (mode === "prompt") return false
      return handled()
    }

    // REPLACE MODE
    if (replaceMode()) {
      setReplaceMode(false)
      if (key.length === 1 && !evt.ctrl && !evt.meta && key !== "escape") {
        const char = key
        const action = () => {
          textarea.deleteChar()
          textarea.insertText(char)
          textarea.moveCursorLeft()
        }
        action()
        setLastAction(() => action)
        contentChanged()
      }
      return handled()
    }

    // NORMAL MODE - Command parsing
    const pending = command()

    // Escape aborts pending command
    if (key === "escape" && pending) {
      setCommand("")
      return handled()
    }

    const cmd = pending + key

    // Operator patterns: dd, d3d, yy, y5y, cc, c2c
    const opMatch = cmd.match(/^([dyc])(\d*)([dyc])$/)
    if (opMatch && opMatch[1] === opMatch[3]) {
      setCommand("")
      const op = opMatch[1]
      const count = opMatch[2] ? parseInt(opMatch[2], 10) : 1
      if (op === "d") {
        const action = () => deleteLines(count)
        action()
        setLastAction(() => action)
        return handled()
      }
      if (op === "y") {
        yankLines(count)
        return handled()
      }
      if (op === "c") {
        enterInsert("cc/c{n}c")
        deleteLines(count)
        return handled()
      }
    }

    // d/, c/, y/ - operator with forward search motion
    // d?, c?, y? - operator with backward search motion
    const opSearchMatch = cmd.match(/^([dyc])([/?])$/)
    if (opSearchMatch && mode === "full") {
      setCommand("")
      const op = opSearchMatch[1] as "d" | "c" | "y"
      const dir = opSearchMatch[2] === "/" ? "forward" : "backward"
      setSearchOperator(op)
      setSearchMode(true)
      setSearchBuffer("")
      setSearchDirection(dir)
      return handled()
    }

    // dG - delete to end
    if (cmd === "dG") {
      setCommand("")

      const action = () => deleteToLine(lines().length - 1)
      action()
      setLastAction(() => action)
      return handled()
    }

    // d{n}G - delete to line N
    const dGMatch = cmd.match(/^d(\d+)G$/)
    if (dGMatch) {
      setCommand("")

      const target = parseInt(dGMatch[1], 10) - 1
      const action = () => deleteToLine(target)
      action()
      setLastAction(() => action)
      return handled()
    }

    // d{n}w, c{n}w
    const opWordMatch = cmd.match(/^([dc])(\d*)w$/)
    if (opWordMatch) {
      setCommand("")
      const op = opWordMatch[1]
      const count = opWordMatch[2] ? parseInt(opWordMatch[2], 10) : 1

      const action = () => deleteWords(count)
      action()
      setLastAction(() => action)

      if (op === "c") {
        // After deleting, if cursor is on non-whitespace, insert space to preserve word separation
        const c = cursor()
        const char = lines()[c.row]?.[c.col]
        if (char && !/\s/.test(char)) {
          textarea.insertText(" ")
          textarea.moveCursorLeft()
          contentChanged()
        }
        enterInsert("c{n}w")
      }
      return handled()
    }

    // y$
    if (cmd === "y$") {
      setCommand("")
      const c = cursor()
      const yanked = lines()[c.row]?.slice(c.col) || ""
      if (yanked) setYank(yanked)
      return handled()
    }

    // yG - yank from current position to end of file
    if (cmd === "yG") {
      setCommand("")
      const c = cursor()
      const ls = lines()
      const currentLineRest = ls[c.row]?.slice(c.col) || ""
      const remainingLines = ls.slice(c.row + 1)
      const yanked = currentLineRest + (remainingLines.length ? "\n" + remainingLines.join("\n") : "")
      if (yanked) setYank(yanked)
      return handled()
    }

    // y% - yank to matching bracket
    if (cmd === "y%") {
      setCommand("")
      const text = textarea.plainText
      const startOffset = textarea.cursorOffset
      const char = text[startOffset]
      const pairs: Record<string, string> = {
        "(": ")",
        ")": "(",
        "[": "]",
        "]": "[",
        "{": "}",
        "}": "{",
      }
      const match = pairs[char]
      if (match) {
        const isOpen = "([{".includes(char)
        let depth = 1
        let endOffset = startOffset

        if (isOpen) {
          for (let i = startOffset + 1; i < text.length; i++) {
            if (text[i] === char) depth++
            if (text[i] === match) depth--
            if (depth === 0) {
              endOffset = i
              break
            }
          }
        } else {
          for (let i = startOffset - 1; i >= 0; i--) {
            if (text[i] === char) depth++
            if (text[i] === match) depth--
            if (depth === 0) {
              endOffset = i
              break
            }
          }
        }
        const start = Math.min(startOffset, endOffset)
        const end = Math.max(startOffset, endOffset) + 1
        const yanked = text.slice(start, end)
        if (yanked) setYank(yanked)
      }
      return handled()
    }

    // y} - yank to next paragraph
    if (cmd === "y}") {
      setCommand("")
      const c = cursor()
      const ls = lines()
      const startOffset = textarea.cursorOffset
      const target = ls.slice(c.row + 1).findIndex((line, i) => {
        const prev = ls[c.row + i]
        return line.trim() === "" && prev && prev.trim() !== ""
      })
      const targetRow = target === -1 ? ls.length - 1 : c.row + 1 + target
      const targetOffset = ls.slice(0, targetRow).join("\n").length
      const yanked = textarea.plainText.slice(startOffset, targetOffset)
      if (yanked) setYank(yanked)
      return handled()
    }

    // y{ - yank to previous paragraph
    if (cmd === "y{") {
      setCommand("")
      const c = cursor()
      const ls = lines()
      const startOffset = textarea.cursorOffset
      const target = ls
        .slice(0, c.row)
        .reverse()
        .findIndex((line, i) => {
          const prev = ls[c.row - 1 - i - 1]
          return line.trim() !== "" && (!prev || prev.trim() === "")
        })
      const targetRow = target === -1 ? 0 : c.row - 1 - target
      const targetOffset = ls.slice(0, targetRow).join("\n").length
      const start = Math.min(startOffset, targetOffset)
      const end = Math.max(startOffset, targetOffset)
      const yanked = textarea.plainText.slice(start, end)
      if (yanked) setYank(yanked)
      return handled()
    }

    // d$ - delete to end of line (same as D)
    if (cmd === "d$") {
      setCommand("")

      const action = () => {
        const c = cursor()
        const yanked = lines()[c.row]?.slice(c.col) || ""
        if (yanked) setYank(yanked)
        textarea.deleteToLineEnd()
        clamp()
        contentChanged()
      }
      action()
      setLastAction(() => action)
      return handled()
    }

    // g{n}g
    const gMatch = cmd.match(/^g(\d*)g$/)
    if (gMatch) {
      setCommand("")
      const num = gMatch[1] ? parseInt(gMatch[1], 10) : 1
      setCursor(num - 1, 0)
      return handled()
    }

    // {n}G
    const countGMatch = cmd.match(/^(\d+)G$/)
    if (countGMatch) {
      setCommand("")
      const num = parseInt(countGMatch[1], 10)
      setCursor(num - 1, 0)
      return handled()
    }

    // {n}x
    const countXMatch = cmd.match(/^(\d+)x$/)
    if (countXMatch) {
      setCommand("")

      const count = parseInt(countXMatch[1], 10)
      const action = () => {
        const c = cursor()
        const len = lineLen(c.row)
        const deleteCount = Math.min(count, len - c.col)
        if (deleteCount > 0) {
          const yanked = lines()[c.row].slice(c.col, c.col + deleteCount)
          setYank(yanked)
          textarea.deleteRange(c.row, c.col, c.row, c.col + deleteCount)
          textarea.requestRender()
        }
        clamp()
        contentChanged()
      }
      action()
      setLastAction(() => action)
      return handled()
    }

    // {n}{motion}
    const countMotionMatch = cmd.match(/^(\d+)([hjklwb])$/)
    if (countMotionMatch) {
      setCommand("")
      const count = parseInt(countMotionMatch[1], 10)
      const motion = countMotionMatch[2]
      if (motion === "h") repeat(count, () => textarea.moveCursorLeft())
      if (motion === "j") {
        repeat(count, () => textarea.moveCursorDown())
        clamp()
      }
      if (motion === "k") {
        repeat(count, () => textarea.moveCursorUp())
        clamp()
      }
      if (motion === "l") {
        repeat(count, () => {
          if (cursor().col < maxCol(cursor().row)) textarea.moveCursorRight()
        })
      }
      if (motion === "w") {
        repeat(count, () => textarea.moveWordForward())
        clamp()
      }
      if (motion === "b") repeat(count, () => textarea.moveWordBackward())
      return handled()
    }

    // Pending commands
    if (/^[dycg]\d*$/.test(cmd) || /^[1-9]\d*$/.test(cmd)) {
      setCommand(cmd)
      return handled()
    }

    setCommand("")

    // Single key movements - pass through to native handling
    if (key === "h" || key === "left") {
      textarea.moveCursorLeft()
      return handled()
    }
    if (key === "j" || key === "down") {
      textarea.moveCursorDown()
      return handled()
    }
    if (key === "k" || key === "up") {
      textarea.moveCursorUp()
      return handled()
    }
    if (key === "l" || key === "right") {
      textarea.moveCursorRight()
      return handled()
    }
    if (key === "w") {
      textarea.moveWordForward()
      clamp()
      return handled()
    }
    if (key === "b" && !evt.ctrl) {
      textarea.moveWordBackward()
      return handled()
    }
    if (key === "e") {
      textarea.moveWordForward()
      textarea.moveCursorLeft()
      clamp()
      return handled()
    }
    if (key === "0") {
      setCursor(cursor().row, 0)
      return handled()
    }
    if (key === "$") {
      setCursor(cursor().row, maxCol(cursor().row))
      return handled()
    }
    if (key === "G" && !pending) {
      textarea.gotoBufferEnd()
      clamp()
      return handled()
    }
    if (key === "{") {
      const c = cursor()
      const ls = lines()
      const target = ls
        .slice(0, c.row)
        .reverse()
        .findIndex((line, i) => {
          const prev = ls[c.row - 1 - i - 1]
          return line.trim() !== "" && (!prev || prev.trim() === "")
        })
      setCursor(target === -1 ? 0 : c.row - 1 - target, 0)
      return handled()
    }
    if (key === "}") {
      const c = cursor()
      const ls = lines()
      const target = ls.slice(c.row + 1).findIndex((line, i) => {
        const prev = ls[c.row + i]
        return line.trim() === "" && prev && prev.trim() !== ""
      })
      setCursor(target === -1 ? ls.length - 1 : c.row + 1 + target, 0)
      return handled()
    }

    // Match bracket
    if (key === "%") {
      const c = cursor()
      const line = lines()[c.row]
      const char = line?.[c.col]
      const pairs: Record<string, string> = {
        "(": ")",
        ")": "(",
        "[": "]",
        "]": "[",
        "{": "}",
        "}": "{",
      }
      const match = pairs[char]
      if (match) {
        const isOpen = "([{".includes(char)
        const text = textarea.plainText
        const startOffset = textarea.cursorOffset
        let depth = 1

        if (isOpen) {
          for (let i = startOffset + 1; i < text.length; i++) {
            if (text[i] === char) depth++
            if (text[i] === match) depth--
            if (depth === 0) {
              textarea.cursorOffset = i
              break
            }
          }
        } else {
          for (let i = startOffset - 1; i >= 0; i--) {
            if (text[i] === char) depth++
            if (text[i] === match) depth--
            if (depth === 0) {
              textarea.cursorOffset = i
              break
            }
          }
        }
      }
      return handled()
    }

    // Insert entry
    if (key === "i") {
      enterInsert("i")
      return handled()
    }
    if (key === "a") {
      setCursor(cursor().row, cursor().col + 1, false)
      enterInsert("a")
      return handled()
    }
    if (key === "I") {
      enterInsert("I")
      setCursor(cursor().row, 0, false)
      return handled()
    }
    if (key === "A") {
      setCursor(cursor().row, lineLen(cursor().row), false)
      enterInsert("A")
      return handled()
    }
    if (key === "o") {
      enterInsert("o")
      textarea.gotoLineEnd()
      textarea.insertText("\n")
      contentChanged()
      return handled()
    }
    if (key === "O") {
      enterInsert("O")
      setCursor(cursor().row, 0, false)
      textarea.insertText("\n")
      textarea.moveCursorUp()
      contentChanged()
      return handled()
    }

    // Delete
    if (key === "x") {
      const action = () => {
        const c = cursor()
        const char = lines()[c.row]?.[c.col]
        if (char && options.clipX) setYank(char)
        textarea.deleteChar()
        clamp()
        contentChanged()
      }
      action()
      setLastAction(() => action)
      return handled()
    }
    if (key === "D") {
      const action = () => {
        const c = cursor()
        const yanked = lines()[c.row]?.slice(c.col) || ""
        if (yanked) setYank(yanked)
        textarea.deleteToLineEnd()
        clamp()
        contentChanged()
      }
      action()
      setLastAction(() => action)
      return handled()
    }

    // Change
    if (key === "C") {
      const c = cursor()
      const yanked = lines()[c.row]?.slice(c.col) || ""
      if (yanked) setYank(yanked)
      enterInsert("C")
      textarea.deleteToLineEnd()
      contentChanged()
      return handled()
    }

    // Paste
    if (key === "p") {
      const action = () => {
        const y = yankReg()
        if (!y) return
        if (y.endsWith("\n")) {
          const c = cursor()
          textarea.gotoLineEnd()
          textarea.insertText("\n" + y.slice(0, -1))
          setCursor(c.row + 1, 0)
        }
        if (!y.endsWith("\n")) {
          textarea.moveCursorRight()
          textarea.insertText(y)
        }
        contentChanged()
      }
      action()
      setLastAction(() => action)
      return handled()
    }
    if (key === "P") {
      const action = () => {
        const y = yankReg()
        if (!y) return
        if (y.endsWith("\n")) {
          const c = cursor()
          setCursor(c.row, 0, false)
          textarea.insertText(y)
          setCursor(c.row, 0)
        }
        if (!y.endsWith("\n")) {
          textarea.insertText(y)
        }
        contentChanged()
      }
      action()
      setLastAction(() => action)
      return handled()
    }

    // Join
    if (key === "J") {
      const action = () => {
        const c = cursor()
        const ls = lines()
        if (c.row >= ls.length - 1) return
        const len = lineLen(c.row)
        textarea.deleteRange(c.row, len, c.row + 1, 0)
        const next = ls[c.row + 1]?.[0]
        if (next && next !== " ") {
          setCursor(c.row, len, false)
          textarea.insertText(" ")
        }
        textarea.requestRender()
        contentChanged()
      }
      action()
      setLastAction(() => action)
      return handled()
    }

    // Repeat
    if (key === ".") {
      const action = lastAction()
      if (action) action()
      return handled()
    }

    // Replace
    if (key === "r" && !evt.ctrl) {
      setReplaceMode(true)
      return handled()
    }

    // Substitute
    if (key === "s") {
      enterInsert("s")
      const action = () => {
        textarea.deleteChar()
        contentChanged()
      }
      action()
      setLastAction(() => action)
      return handled()
    }

    // Toggle case
    if (key === "~") {
      const action = () => {
        const c = cursor()
        const char = lines()[c.row]?.[c.col]
        if (!char) return
        const toggled = char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()
        textarea.deleteChar()
        textarea.insertText(toggled)
        clamp()
        contentChanged()
      }
      action()
      setLastAction(() => action)
      return handled()
    }

    // Undo - use native textarea undo
    if (key === "u") {
      textarea.undo()
      clamp()
      contentChanged()
      return handled()
    }

    // Redo
    if (evt.ctrl && evt.name === "r") {
      textarea.redo()
      clamp()
      contentChanged()
      return handled()
    }

    // Page movement
    if (evt.ctrl && key === "f") {
      const size = textarea.height - 2
      repeat(size, () => textarea.moveCursorDown())
      clamp()
      return handled()
    }
    if (evt.ctrl && key === "b") {
      const size = textarea.height - 2
      repeat(size, () => textarea.moveCursorUp())
      clamp()
      return handled()
    }

    // Search commands (only for full mode, not prompt)
    if (mode === "full") {
      // / - start forward search
      if (key === "/") {
        setSearchMode(true)
        setSearchBuffer("")
        setSearchDirection("forward")
        return handled()
      }
      // ? - start backward search
      if (key === "?") {
        setSearchMode(true)
        setSearchBuffer("")
        setSearchDirection("backward")
        return handled()
      }
      // n - next match (same direction)
      if (key === "n") {
        const pattern = searchPattern()
        if (pattern) findMatch(pattern, searchDirection())
        return handled()
      }
      // N - previous match (opposite direction)
      if (key === "N") {
        const pattern = searchPattern()
        if (pattern) findMatch(pattern, searchDirection() === "forward" ? "backward" : "forward")
        return handled()
      }
    }

    if (key === "escape") return handled()

    return false
  }

  const reset = () => {
    setState(config.startInsert ? "insert" : "normal")
    setCommand("")
    setReplaceMode(false)
    setSearchMode(false)
    setSearchBuffer("")
    setSearchOperator(null)
  }

  return {
    state,
    command,
    yank: yankReg,
    replaceMode,
    handleKey,
    reset,
    searchMode,
    searchBuffer,
    searchPattern,
  }
}
