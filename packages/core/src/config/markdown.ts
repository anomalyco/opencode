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
  const lines = frontmatter.split(/\r?\n/)
  const entry = (line: string) => line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
  const plain = (value: string) =>
    value !== "" && value !== ">" && value !== "|" && !value.startsWith('"') && !value.startsWith("'")

  // Pass 1: quote a plain scalar that begins with a flow indicator ([ or {) when
  // it is not valid flow syntax. YAML reads the leading bracket as a flow
  // collection, so `description: [Team] Does a thing` throws (text after the
  // closing bracket) and the whole document is dropped silently. A well-formed
  // flow collection is left alone, including an alias reference like
  // `permissions: [*rule]` which must stay a flow sequence.
  const flowFixed = lines.flatMap((line) => {
    const found = entry(line)
    if (!found) return [line]
    const value = found[2].trim()
    if (!plain(value)) return [line]
    if (!/^[\[{]/.test(value)) return [line]
    if (!/^[\[{].*[\]}]\s*\S/.test(value)) return [line]
    return [`${found[1]}: ${JSON.stringify(value)}`]
  })

  // Pass 2: retry any remaining plain scalar containing an unquoted colon as a
  // block scalar. Pure anchor definitions, aliases and tags are structural YAML
  // and must be left untouched, but values that merely start with `*`/`&`/`!`
  // (`description: *Important*: read this`) still need the fallback.
  const colonFixed = flowFixed.flatMap((line) => {
    const found = entry(line)
    if (!found) return [line]
    const value = found[2].trim()
    if (!plain(value)) return [line]
    // Flow values were settled in pass 1; never block-scalar them here.
    if (/^[\[{]/.test(value)) return [line]
    if (/^&[A-Za-z0-9_-]+(?:\s|$)/.test(value)) return [line]
    if (/^\*[A-Za-z0-9_-]+$/.test(value)) return [line]
    if (/^![A-Za-z0-9_-]+$/.test(value)) return [line]
    if (!value.includes(":")) return [line]
    return [`${found[1]}: |-`, `  ${value}`]
  })

  return content.replace(frontmatter, () => colonFixed.join("\n"))
}

function parseable(frontmatter: string): boolean {
  try {
    matter(`---\n${frontmatter}\n---\n`, {})
    return true
  } catch {
    return false
  }
}
