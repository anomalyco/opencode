const MAX_SEQUENCE_LENGTH = 4 * 1024

type Mode = "text" | "escape" | "csi" | "osc" | "osc-escape" | "control" | "control-escape"

/**
 * Incrementally reduces line-oriented terminal output to visible text. This
 * models horizontal cursor changes but intentionally does not emulate a full
 * screen or vertical cursor movement.
 */
export function make(options?: { maxLineLength?: number }) {
  const cells: string[] = []
  const maxLineLength = options?.maxLineLength ?? Number.POSITIVE_INFINITY
  let cursor = 0
  let savedCursor = 0
  let mode: Mode = "text"
  let sequence = ""
  let lineTruncated = false
  let outputTruncated = false

  const resetLine = () => {
    cells.length = 0
    cursor = 0
    savedCursor = 0
    lineTruncated = false
  }

  const commit = (newline: boolean) => {
    const output = cells.join("") + (newline ? "\n" : "")
    outputTruncated = outputTruncated || lineTruncated
    resetLine()
    return output
  }

  const parameter = (index: number, fallback: number) => {
    const value = Number.parseInt(sequence.split(";")[index] ?? "", 10)
    return Number.isFinite(value) && value > 0 ? value : fallback
  }

  const eraseLine = () => {
    const value = Number.parseInt(sequence.split(";")[0] ?? "0", 10)
    if (value === 2) {
      cells.length = 0
      lineTruncated = false
      return
    }
    if (value === 1) {
      const end = Math.min(cursor, cells.length - 1)
      for (let i = 0; i <= end; i++) cells[i] = " "
      if (cursor >= maxLineLength) lineTruncated = false
      return
    }
    if (cursor < cells.length) cells.length = cursor
    if (cursor <= maxLineLength) lineTruncated = false
  }

  const applyCSI = (final: string) => {
    if (final === "K") return eraseLine()
    if (final === "C" || final === "a") {
      cursor += parameter(0, 1)
      return
    }
    if (final === "D") {
      cursor = Math.max(0, cursor - parameter(0, 1))
      return
    }
    if (final === "G" || final === "`") {
      cursor = parameter(0, 1) - 1
      return
    }
    if (final === "H" || final === "f") {
      if (parameter(0, 1) === 1) cursor = parameter(1, 1) - 1
      return
    }
    if (final === "s") savedCursor = cursor
    if (final === "u") cursor = savedCursor
  }

  const printable = (char: string) => {
    if (cursor < maxLineLength) {
      while (cells.length < cursor) cells.push(" ")
      cells[cursor] = char
    } else {
      lineTruncated = true
    }
    cursor += 1
  }

  const write = (input: string) => {
    const output: string[] = []
    for (const char of input) {
      const code = char.codePointAt(0) ?? 0

      if (mode === "osc") {
        if (char === "\u0007" || char === "\u009c") mode = "text"
        if (char === "\u001b") mode = "osc-escape"
        continue
      }
      if (mode === "osc-escape") {
        mode = char === "\\" ? "text" : "osc"
        continue
      }
      if (mode === "control") {
        if (char === "\u009c") mode = "text"
        if (char === "\u001b") mode = "control-escape"
        continue
      }
      if (mode === "control-escape") {
        mode = char === "\\" ? "text" : "control"
        continue
      }
      if (mode === "escape") {
        mode = "text"
        if (char === "[") mode = "csi"
        if (char === "]") mode = "osc"
        if (char === "P" || char === "X" || char === "^" || char === "_") mode = "control"
        continue
      }
      if (mode === "csi") {
        if (char === "\u001b") {
          sequence = ""
          mode = "escape"
          continue
        }
        if (code >= 0x40 && code <= 0x7e) {
          applyCSI(char)
          sequence = ""
          mode = "text"
          continue
        }
        sequence += char
        if (sequence.length > MAX_SEQUENCE_LENGTH) {
          sequence = ""
          mode = "text"
        }
        continue
      }

      if (char === "\u001b") {
        mode = "escape"
        continue
      }
      if (char === "\u009b") {
        mode = "csi"
        continue
      }
      if (char === "\u009d") {
        mode = "osc"
        continue
      }
      if (char === "\u0090" || char === "\u0098" || char === "\u009e" || char === "\u009f") {
        mode = "control"
        continue
      }
      if (char === "\r") {
        cursor = 0
        continue
      }
      if (char === "\n") {
        output.push(commit(true))
        continue
      }
      if (char === "\b") {
        cursor = Math.max(0, cursor - 1)
        continue
      }
      if (char === "\t") {
        cursor += 8 - (cursor % 8)
        continue
      }
      if (code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0)) continue
      printable(char)
    }
    return output.join("")
  }

  return {
    write,
    current: () => cells.join(""),
    finish: () => commit(false),
    truncated: () => outputTruncated || lineTruncated,
  }
}

export function render(input: string) {
  const state = make()
  return state.write(input) + state.finish()
}

export * as TerminalOutput from "./terminal-output"
