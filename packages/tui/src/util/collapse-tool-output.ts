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
  const content = [input, output].filter(Boolean).join("\n\n")
  const collapsed = collapseToolOutput(content, maxLines, maxChars)
  if (!collapsed.overflow) return { input, output, overflow: false }
  if (!input) return { input, output: collapseTail(output, maxLines, maxChars), overflow: true }
  if (!output) return { input: collapsed.output, output, overflow: true }

  const reserved = Math.max(1, Math.floor(maxChars / maxLines))
  const command = collapseToolOutput(
    input,
    Math.max(1, maxLines - 2),
    Math.max(1, maxChars - reserved - 2),
  ).output
  const lines = Math.max(1, maxLines - command.split("\n").length - 1)
  const chars = Math.max(1, maxChars - Array.from(command).length - 2)
  return { input: command, output: collapseTail(output, lines, chars), overflow: true }
}

function collapseTail(output: string, maxLines: number, maxChars: number) {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) return output

  const preview = lines.slice(-maxLines).join("\n")
  const visible = Array.from(preview)
  if (visible.length < maxChars) return `…${preview}`
  return `…${visible.slice(-Math.max(0, maxChars - 1)).join("")}`
}
