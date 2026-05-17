export type StreamingMarkdownTail = {
  content: string
  filetype: string
}

export type StreamingMarkdownSplit = {
  head: string
  tail?: StreamingMarkdownTail
}

type FenceBlock = {
  headEnd: number
  contentStart: number
  filetype: string
}

const FENCE_FILETYPE_ALIASES: Record<string, string> = {
  bash: "shellscript",
  sh: "shellscript",
  zsh: "shellscript",
  shell: "shellscript",
  console: "shellscript",
  js: "typescript",
  jsx: "typescript",
  mjs: "typescript",
  cjs: "typescript",
  javascript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  py: "python",
}

function normalizeFenceFiletype(info: string) {
  const language = info.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  if (!language) return "none"
  return FENCE_FILETYPE_ALIASES[language] ?? language
}

export function splitStreamingMarkdown(text: string): StreamingMarkdownSplit {
  const lines = text.split("\n")
  let offset = 0
  let trailing: (FenceBlock & { tailEnd: number }) | undefined
  let open:
    | (FenceBlock & {
        char: string
        size: number
      })
    | undefined

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ""
    const lineStart = offset
    const lineEnd = lineStart + line.length
    const contentStart = lineEnd < text.length ? lineEnd + 1 : lineEnd

    if (!open) {
      const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/)
      if (match) {
        const mark = match[1]
        if (mark) {
          trailing = undefined
          open = {
            headEnd: lineStart,
            contentStart,
            char: mark[0] ?? "`",
            size: mark.length,
            filetype: normalizeFenceFiletype(match[2] ?? ""),
          }
        }
      } else if (line.trim()) {
        trailing = undefined
      }
      offset = contentStart
      continue
    }

    const close = new RegExp(`^[\\t ]{0,3}${open.char}{${open.size},}[\\t ]*$`)
    if (close.test(line)) {
      trailing = {
        headEnd: open.headEnd,
        contentStart: open.contentStart,
        tailEnd: lineStart,
        filetype: open.filetype,
      }
      open = undefined
    }
    offset = contentStart
  }

  if (open) {
    return {
      head: text.slice(0, open.headEnd),
      tail: {
        content: text.slice(open.contentStart),
        filetype: open.filetype,
      },
    }
  }

  if (!trailing) return { head: text }

  return {
    head: text.slice(0, trailing.headEnd),
    tail: {
      content: text.slice(trailing.contentStart, trailing.tailEnd),
      filetype: trailing.filetype,
    },
  }
}
