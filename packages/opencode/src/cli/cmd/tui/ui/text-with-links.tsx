import { For, createMemo } from "solid-js"
import { FilePathLink, Link } from "./link"
import type { RGBA } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

const PATH_REGEX =
  /((?:https?:\/\/[^\s"'()<>]+)|(?:\/|~|\.\.?\/)[^\s"'()<>]+|(?:[\w.-]+\/[^\s"'()<>]*)|(?:[a-zA-Z][\w.-]*\.\w{2,})|(?:[\w.-]+[*@/])|(?:\*\*[^*]+\*\*)|(?:_[^_]+_)|(?:`[^`]+`))/g

export function TextWithLinks(props: { text: string; fg?: RGBA }) {
  const { theme } = useTheme()

  const parts = createMemo(() => {
    const text = props.text
    const result = []
    let lastIndex = 0
    let match

    PATH_REGEX.lastIndex = 0
    while ((match = PATH_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: "text", content: text.slice(lastIndex, match.index) })
      }

      let content = match[0]

      // Handle Markdown formatting
      if (content.startsWith("**") && content.endsWith("**")) {
        result.push({ type: "bold", content: content.slice(2, -2) })
      } else if (content.startsWith("_") && content.endsWith("_")) {
        // TUI might not support italic widely, but we can try or use another style
        result.push({ type: "italic", content: content.slice(1, -1) })
      } else if (content.startsWith("`") && content.endsWith("`")) {
        // For code spans, we strip backticks.
        // Optionally we could check if the code content is a file path?
        // Let's just treat it as styled text for now to be safe.
        result.push({ type: "code", content: content.slice(1, -1) })
      } else {
        // Trim trailing punctuation usually found at end of sentences or in lists
        const suffixMatch = content.match(/[.,:;`'"})\]>]+$/)
        const suffix = suffixMatch ? suffixMatch[0] : ""
        content = content.substring(0, content.length - suffix.length)

        if (content.length < 2) {
          result.push({ type: "text", content: match[0] })
        } else {
          const isUrl = content.startsWith("http")
          result.push({
            type: isUrl ? "url" : "path",
            content: content,
          })
          if (suffix) {
            result.push({ type: "text", content: suffix })
          }
        }
      }

      lastIndex = PATH_REGEX.lastIndex
    }

    if (lastIndex < text.length) {
      result.push({ type: "text", content: text.slice(lastIndex) })
    }

    return result
  })

  return (
    <text fg={props.fg}>
      <For each={parts()}>
        {(part) => {
          if (part.type === "url") {
            return (
              <Link href={part.content} fg={props.fg}>
                {part.content}
              </Link>
            )
          }
          if (part.type === "path") {
            return (
              <FilePathLink path={part.content} fg={props.fg}>
                {part.content}
              </FilePathLink>
            )
          }
          if (part.type === "bold") {
            return <span style={{ bold: true }}>{part.content}</span>
          }
          if (part.type === "italic") {
            return <span style={{ italic: true }}>{part.content}</span>
          }
          if (part.type === "code") {
            return <span style={{ bg: theme.backgroundElement }}>{part.content}</span>
          }
          return part.content
        }}
      </For>
    </text>
  )
}
