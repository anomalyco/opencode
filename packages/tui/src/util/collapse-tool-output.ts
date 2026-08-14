export function collapseToolOutput(output: string, maxLines: number, maxChars: number) {
  if (!Number.isSafeInteger(maxLines) || maxLines < 0 || !Number.isSafeInteger(maxChars) || maxChars < 0) {
    const lines = output.split("\n")
    if (lines.length <= maxLines && Array.from(output).length <= maxChars) return { output, overflow: false }
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
  if (maxLines === 0) return { output: "…", overflow: true }

  const preview: string[] = []
  let lines = 1
  for (const char of output) {
    if (char === "\n" && lines >= maxLines) {
      return { output: `${preview.join("")}\n…`, overflow: true }
    }
    preview.push(char)
    if (preview.length > maxChars) {
      return { output: preview.slice(0, Math.max(0, maxChars - 1)).join("") + "…", overflow: true }
    }
    if (char === "\n") lines++
  }

  return { output, overflow: false }
}
