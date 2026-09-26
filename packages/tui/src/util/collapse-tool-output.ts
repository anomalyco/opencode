export function collapseToolOutput(output: string, maxLines: number, maxChars: number) {
  const lines = output.split("\n", maxLines + 1)
  // Code points, not UTF-16 units: an astral glyph must count as one character or the
  // bound is exceeded by surrogate pairs.
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) {
    return { output, overflow: false }
  }

  const preview = lines.slice(0, maxLines).join("\n")
  if (Array.from(preview).length > maxChars) {
    return { output: Array.from(preview).slice(0, Math.max(0, maxChars - 1)).join("") + "…", overflow: true }
  }

  return { output: [...lines.slice(0, maxLines), "…"].join("\n"), overflow: true }
}
