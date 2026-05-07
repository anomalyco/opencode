import { createMemo, For } from "solid-js"
import { Link } from "../ui/link"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g

interface LinkifiedTextProps {
  text: string
}

export function LinkifiedText(props: LinkifiedTextProps) {
  const { theme } = useTheme()

  const parts = createMemo(() => {
    const text = props.text
    const result: Array<{ type: "text" | "url"; content: string }> = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    const regex = new RegExp(URL_REGEX)
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: "text", content: text.slice(lastIndex, match.index) })
      }
      result.push({ type: "url", content: match[0] })
      lastIndex = match.index + match[0].length
    }

    if (lastIndex < text.length) {
      result.push({ type: "text", content: text.slice(lastIndex) })
    }

    return result
  })

  return (
    <For each={parts()}>
      {(part) =>
        part.type === "url" ? (
          <Link href={part.content} fg={theme.primary}>
            {part.content}
          </Link>
        ) : (
          <text fg={theme.text}>{part.content}</text>
        )
      }
    </For>
  )
}