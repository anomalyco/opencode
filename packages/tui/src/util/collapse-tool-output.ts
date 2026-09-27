import { Locale } from "./locale"
import { stringWidth } from "./string-width"

export function collapseToolOutput(output: string, maxLines: number, maxChars: number) {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) {
    return { output, overflow: false }
  }

  const visible = lines.slice(0, maxLines)
  if (lines.length > maxLines && visible.length > 0) visible[visible.length - 1] += "…"
  const preview = visible.join("\n")
  if (Array.from(preview).length > maxChars) {
    return {
      output:
        Array.from(preview)
          .slice(0, Math.max(0, maxChars - 1))
          .join("") + "…",
      overflow: true,
    }
  }

  return { output: preview, overflow: true }
}

export function collapseShellOutput(input: string, output: string, maxLines: number, maxChars: number) {
  if (!input) {
    const collapsed = collapseToolOutput(output, maxLines, maxChars)
    return {
      input,
      output: collapsed.overflow ? collapseTail(output, maxLines, maxChars) : output,
      overflow: collapsed.overflow,
    }
  }

  const commandLines = Math.min(2, maxLines)
  const lineChars = Math.max(1, Math.floor(maxChars / Math.max(1, maxLines)))
  const command = collapseShellCommand(input, commandLines, lineChars)
  if (!output) return { input: command.output, output, overflow: command.overflow }

  const lines = Math.max(1, maxLines - command.lines - 1)
  const chars = Math.max(1, maxChars - Array.from(command.output).length - 2)
  const collapsed = collapseToolOutput(output, lines, chars)
  return {
    input: command.output,
    output: collapsed.overflow ? collapseTail(output, lines, chars) : output,
    overflow: command.overflow || collapsed.overflow,
  }
}

function collapseShellCommand(input: string, maxLines: number, lineWidth: number) {
  const visible: string[] = []
  let lines = 1
  let width = 0
  const overflow = Locale.graphemes(input).some((segment) => {
    if (segment === "\n") {
      if (lines >= maxLines) return true
      visible.push(segment)
      lines++
      width = 0
      return false
    }

    const next = stringWidth(segment)
    if (width + next > lineWidth) {
      if (lines >= maxLines) return true
      lines++
      width = 0
    }
    visible.push(segment)
    width += next
    return false
  })
  if (!overflow) return { output: input, overflow, lines }

  if (width >= lineWidth) {
    const removed = visible.pop()
    if (removed !== undefined && removed !== "\n") width -= stringWidth(removed)
  }
  return { output: visible.join("") + "…", overflow, lines }
}

function collapseTail(output: string, maxLines: number, maxChars: number) {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) return output

  const count = Math.max(1, lines.length - Math.max(0, maxLines - 1))
  const label = `(${count} earlier ${count === 1 ? "line" : "lines"})`
  if (maxLines <= 1) return label

  const preview = Array.from(lines.slice(-(maxLines - 1)).join("\n"))
  const available = maxChars - Array.from(label).length - 1
  if (available <= 0) return label
  return `${label}\n${preview.slice(-available).join("")}`
}
