import path from "node:path"
import { docsDir } from "./i18n-common"

const markdown = /\]\(\/docs\/[\S)]*\)/g
const html = /href\s*=\s*(["'])\/docs\/[\s\S]*?\1/g

function scrubInlineCode(line: string) {
  return line.replace(/`[^`]*`/g, "")
}

const malformedPatterns = [
  {
    reason: "malformed markdown link (extra '[')",
    regex: /\[\[[^\]]*\]\([^)]*\)/g,
  },
  {
    reason: "malformed markdown link (extra ']')",
    regex: /\[[^\[]*\]\]\([^)]*\)/g,
  },
  {
    reason: "malformed markdown link (extra ']')",
    regex: /\[[^\]]*\]\([^)]*\)\]/g,
  },
]

function rowAt(lineStarts: number[], index: number) {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (lineStarts[mid] <= index) {
      low = mid + 1
      continue
    }
    high = mid - 1
  }
  return high < 0 ? 0 : high
}

function findMalformedLinks(text: string) {
  const lines = text.split("\n")
  let fence = false
  const scan = lines.map((line) => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith("```")) {
      fence = !fence
      return ""
    }
    if (fence) {
      return ""
    }
    return scrubInlineCode(line)
  })

  const source = scan.join("\n")
  const lineStarts: number[] = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      lineStarts.push(index + 1)
    }
  }

  const seen = new Set<string>()
  return malformedPatterns.flatMap((pattern) => {
    pattern.regex.lastIndex = 0
    return Array.from(source.matchAll(pattern.regex)).flatMap((match) => {
      const row = rowAt(lineStarts, match.index ?? 0)
      const key = `${row}:${pattern.reason}`
      if (seen.has(key)) {
        return []
      }
      seen.add(key)
      return [{ row, reason: pattern.reason }]
    })
  })
}

const errors: string[] = []
for await (const file of new Bun.Glob("**/*.mdx").scan({ cwd: docsDir })) {
  const text = await Bun.file(path.join(docsDir, file)).text()
  const lines = text.split("\n")
  const malformed = findMalformedLinks(text)
  const malformedByRow = new Map(malformed.map((item) => [item.row, item.reason]))
  let fence = false
  for (const [row, line] of lines.entries()) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith("```")) {
      fence = !fence
      continue
    }

    markdown.lastIndex = 0
    html.lastIndex = 0
    const hasAbsolute = markdown.test(line) || html.test(line)
    const reason = fence ? undefined : malformedByRow.get(row)
    if (!hasAbsolute && !reason) {
      continue
    }
    if (hasAbsolute) {
      errors.push(
        `${path.join("src/content/docs", file)}:${row + 1}: locale-breaking absolute /docs/ link: ${line.trim()}`,
      )
    }
    if (reason) {
      errors.push(`${path.join("src/content/docs", file)}:${row + 1}: ${reason}: ${line.trim()}`)
    }
  }
}

if (errors.length === 0) {
  console.log("No locale-breaking /docs/ links or malformed markdown links found.")
  process.exit(0)
}

console.error("Found docs link issues:")
for (const line of errors) {
  console.error(`- ${line}`)
}
process.exit(1)
