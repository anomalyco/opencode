export * as ConfigMarkdown from "./markdown.js"

import matter from "gray-matter"
export function parse(content: string) {
  // Passing options bypasses gray-matter's module-global content cache, which
  // it populates before parsing: a failed YAML parse poisons the entry and
  // every later parse of the same content replays it without throwing, so the
  // sanitize fallback below never runs. Upstream: jonschlinkert/gray-matter#166.
  try {
    return matter(content, {})
  } catch {
    return matter(sanitize(content), {})
  }
}

export function parseOption(content: string) {
  try {
    return parse(content)
  } catch {
    return undefined
  }
}

// Other coding agents accept unquoted colons and leading tags like `[Tag] text`
// in frontmatter values. Retry those values as YAML block scalars so existing
// config files keep working.
export function sanitize(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content
  const frontmatter = match[1]
  const lines = frontmatter.split(/\r?\n/)
  const result = lines.flatMap((line, index) => {
    if (line.trim().startsWith("#") || line.trim() === "" || /^\s+/.test(line)) return [line]
    const entry = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
    if (!entry) return [line]
    const value = entry[2].trim()
    if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) return [line]
    // Keep valid inline YAML structures intact while repairing unrelated prose fields.
    if (/^[\[{]/.test(value) && isYamlFlowValue(lines, index)) return [line]
    if (!value.includes(":") && !/^[[{].*[\]}]\s*\S/.test(value)) return [line]
    return [`${entry[1]}: |-`, `  ${value}`]
  })
  return content.replace(frontmatter, () => result.join("\n"))
}

function isYamlFlowValue(lines: string[], index: number) {
  try {
    let end = index + 1
    while (end < lines.length) {
      const line = lines[end]
      if (line.trim() !== "" && !line.startsWith("#") && !/^\s/.test(line)) break
      end++
    }
    const field = lines.slice(index, end).join("\n")
    matter(`---\n${field}\n---\n`, {})
    return true
  } catch {
    return false
  }
}
