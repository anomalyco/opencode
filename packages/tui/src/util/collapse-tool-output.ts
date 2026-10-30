export function collapseToolOutput(output: string, maxLines: number, maxChars: number) {
  if (maxLines === 0) return { output: "", overflow: output.length > 0 }
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) {
    return { output, overflow: false }
  }

  const preview = lines.slice(0, maxLines).join("\n")
  if (Array.from(preview).length > maxChars) {
    return {
      output:
        Array.from(preview)
          .slice(0, Math.max(0, maxChars - 1))
          .join("") + "…",
      overflow: true,
    }
  }

  return { output: [...lines.slice(0, maxLines), "…"].join("\n"), overflow: true }
}

// opencode v2's tail preview (packages/tui/src/util/collapse-tool-output.ts on `dev`), kept as v2 has
// it: a `(N earlier lines)` label and the last lines, `maxLines` rows in all.
export function collapseTail(output: string, maxLines: number, maxChars: number) {
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

// The fork's head-and-tail preview on top of `collapseTail`: the first `head` lines, a `(N more lines)`
// marker and the last lines, `maxLines` rows in all, each part capped at its lines' share of
// `maxChars`. At least one last line shows. Without room for a head, or with no whole line to hide
// (only long lines), it is `collapseTail` itself.
export function collapseHeadTail(output: string, head: number, maxLines: number, maxChars: number) {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) return output

  const first = Math.min(head, maxLines - 2)
  const last = maxLines - first - 1
  if (first < 1 || lines.length <= first + last) return collapseTail(output, maxLines, maxChars)

  const lineChars = Math.max(1, Math.floor(maxChars / maxLines))
  const top = Array.from(lines.slice(0, first).join("\n"))
  const hidden = lines.length - first - last
  return [
    top.length > first * lineChars ? top.slice(0, first * lineChars - 1).join("") + "…" : top.join(""),
    `(${hidden} more ${hidden === 1 ? "line" : "lines"})`,
    Array.from(lines.slice(-last).join("\n"))
      .slice(-last * lineChars)
      .join(""),
  ].join("\n")
}
