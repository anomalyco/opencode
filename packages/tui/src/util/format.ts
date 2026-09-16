export function formatAnswer(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let fenceChar = ""
  let fenceLen = 0
  let blanks = 0
  for (const line of lines) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const mark = fence[1] ?? ""
      const char = mark[0] ?? ""
      if (!fenceChar) {
        fenceChar = char
        fenceLen = mark.length
      } else if (char === fenceChar && mark.length >= fenceLen) {
        fenceChar = ""
        fenceLen = 0
      }
      blanks = 0
      out.push(line)
      continue
    }
    if (fenceChar) {
      out.push(line)
      continue
    }
    if (line.trim() === "") {
      blanks += 1
      if (blanks <= 1 && out.length > 0) out.push("")
      continue
    }
    blanks = 0
    out.push(line.replace(/[ \t]+$/, ""))
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out.join("\n")
}

export function formatDuration(secs: number) {
  if (secs <= 0) return ""
  if (secs < 60) return `${secs}s`
  if (secs < 3600) {
    const mins = Math.floor(secs / 60)
    const remaining = secs % 60
    return remaining > 0 ? `${mins}m ${remaining}s` : `${mins}m`
  }
  if (secs < 86400) {
    const hours = Math.floor(secs / 3600)
    const remaining = Math.floor((secs % 3600) / 60)
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
  }
  if (secs < 604800) {
    const days = Math.floor(secs / 86400)
    return days === 1 ? "~1 day" : `~${days} days`
  }
  const weeks = Math.floor(secs / 604800)
  return weeks === 1 ? "~1 week" : `~${weeks} weeks`
}
