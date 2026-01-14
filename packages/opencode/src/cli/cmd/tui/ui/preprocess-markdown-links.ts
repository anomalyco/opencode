import { homedir } from "os"
import * as path from "path"

// Enhanced regex to better match file paths, including:
// - Paths starting with ~ (like ~/.claude/CLAUDE.md)
// - Paths ending with common file extensions (.md, .txt, .js, etc.)
// - Relative paths with file extensions
// - URLs
const PATH_REGEX =
  /((?:https?:\/\/[^\s"'()<>]+)|(?:[A-Za-z]:[\\\/](?:[^\\\/\s"'()<>:*?]+[\\\/])*[^\\\/\s"'()<>:*?]*)|(?:\/|~|\.\.?\/)[^\s"'()<>]+(?::\d+(?::\d+)?)?|(?:[\w.-]+\/[^\s"'()<>]*)|(?:[a-zA-Z][\w.-]*\.\w{2,})|(?:~\/[^\s"'()<>]+)|(?:\b[A-Za-z][\w.-]*\.(?:md|txt|js|ts|jsx|tsx|py|rb|go|rs|java|cpp|c|h|hpp|css|html|xml|json|yaml|yml|toml|ini|conf|config|sh|bash|zsh|fish|ps1|psm1|bat|cmd)\b))/g

export function preprocessMarkdownLinks(text: string): string {
  const toolPatterns = [
    /\bWrote\s+([^\s\[\]]+(?:\.[a-zA-Z0-9]+)?)/g,
    /\bRead\s+([^\s\[\]]+(?:\.[a-zA-Z0-9]+)?)/g,
    /\bEdit\s+([^\s\[\]]+(?:\.[a-zA-Z0-9]+)?)/g,
    /\bCreated\s+([^\s\[\]]+(?:\.[a-zA-Z0-9]+)?)/g,
    /\bUpdated\s+([^\s\[\]]+(?:\.[a-zA-Z0-9]+)?)/g,
    /\bDeleted\s+([^\s\[\]]+(?:\.[a-zA-Z0-9]+)?)/g,
    /\bFound\s+in\s+([^\s\[\]]+(?:\.[a-zA-Z0-9]+)?)/g,
    /\bFile:\s*([^\s\[\]]+(?:\.[a-zA-Z0-9]+)?)/g,
  ]

  let processedText = text
  for (const pattern of toolPatterns) {
    processedText = processedText.replace(pattern, (match, path) => {
      if (match.includes("[") || match.includes("]")) return match
      if (path.startsWith("http://") || path.startsWith("https://")) return match
      const keyword = match.substring(0, match.indexOf(path)).trim()
      return `${keyword} \`${path}\``
    })
  }

  const protectedRanges: Array<{ start: number; end: number }> = []

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  let match
  while ((match = linkRegex.exec(processedText)) !== null) {
    protectedRanges.push({ start: match.index, end: match.index + match[0].length })
  }

  const codeBlockRegex = /```[\s\S]*?```/g
  while ((match = codeBlockRegex.exec(processedText)) !== null) {
    protectedRanges.push({ start: match.index, end: match.index + match[0].length })
  }

  const inlineCodeRegex = /`[^`]+`/g
  while ((match = inlineCodeRegex.exec(processedText)) !== null) {
    protectedRanges.push({ start: match.index, end: match.index + match[0].length })
  }

  protectedRanges.sort((a, b) => a.start - b.start)

  let result = ""
  let lastIndex = 0

  PATH_REGEX.lastIndex = 0
  while ((match = PATH_REGEX.exec(processedText)) !== null) {
    const matchStart = match.index
    const matchEnd = match.index + match[0].length

    const isProtected = protectedRanges.some(
      (range) =>
        (matchStart >= range.start && matchStart < range.end) || (matchEnd > range.start && matchEnd <= range.end),
    )

    if (isProtected) continue

    let pathMatch = match[0]

    if (pathMatch.startsWith("http")) continue

    if (/^[a-zA-Z]+\.(com|org|net|io|dev|app|ai|co)$/.test(pathMatch)) continue

    if (pathMatch.includes("*") && !pathMatch.endsWith("/*")) continue

    const isWildcardDir = pathMatch.endsWith("/*")
    if (isWildcardDir) {
      pathMatch = pathMatch.slice(0, -2)
    }

    result += processedText.slice(lastIndex, matchStart)

    let href = pathMatch

    if (pathMatch.startsWith("~")) {
      href = pathMatch.replace(/^~/, homedir())
    } else if (
      pathMatch.startsWith("./") ||
      pathMatch.startsWith("../") ||
      (!pathMatch.startsWith("/") && !pathMatch.match(/^[A-Za-z]:[\\\/]/))
    ) {
      href = path.resolve(process.cwd(), pathMatch)
    }

    href = path.normalize(href)

    const fileUrl = `file://${href.startsWith("/") ? "" : "/"}${href.replace(/\\/g, "/")}`

    result += `[${pathMatch}](${fileUrl})`

    lastIndex = matchEnd
  }

  result += processedText.slice(lastIndex)

  return result
}
