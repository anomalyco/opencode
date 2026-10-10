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

// Other coding agents accept unquoted colons in frontmatter values. Retry
// those values as YAML block scalars so existing config files keep working.
export function sanitize(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content
  const frontmatter = match[1]
  const result = frontmatter.split(/\r?\n/).flatMap((line) => {
    if (line.trim().startsWith("#") || line.trim() === "" || /^\s+/.test(line)) return [line]
    const entry = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
    if (!entry) return [line]
    const value = entry[2].trim()
    if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) return [line]
    // A plain scalar beginning with a flow indicator ([ or {) is read as a
    // flow collection. When it is not valid flow syntax (e.g.
    // `description: [Team] Does a thing`) the whole frontmatter block fails to
    // parse and the document is dropped silently; quote it so the value is
    // kept as written. When it *is* valid flow syntax, leave the line alone so
    // a real flow collection (e.g. `tools: {write: false}`) is not rewritten
    // into a block scalar by the colon rule below.
    if (value.startsWith("[") || value.startsWith("{")) {
      if (isParseableValue(value)) return [line]
      return [`${entry[1]}: ${JSON.stringify(value)}`]
    }
    if (!value.includes(":")) return [line]
    return [`${entry[1]}: |-`, `  ${value}`]
  })
  return content.replace(frontmatter, () => result.join("\n"))
}

function isParseableValue(value: string): boolean {
  try {
    matter(`---\nvalue: ${value}\n---\n`, {})
    return true
  } catch {
    return false
  }
}
