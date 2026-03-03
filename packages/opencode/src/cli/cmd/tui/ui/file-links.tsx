import { For, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"

export function FileLinks(props: { content: string }) {
  const { theme } = useTheme()
  const parts = createMemo(() => {
    const matches = props.content.matchAll(/\[([^\]]+)\]\((file:\/\/[^\s)]+)\)/g)
    let offset = 0
    const output: ({ href: string; label: string } | string)[] = []
    for (const match of matches) {
      const index = match.index ?? 0
      if (index > offset) output.push(props.content.slice(offset, index))
      output.push({ href: match[2], label: match[1].replace(/^`(.*)`$/, "$1") })
      offset = index + match[0].length
    }
    if (offset < props.content.length) output.push(props.content.slice(offset))
    return output
  })

  return (
    <text fg={theme.text}>
      <For each={parts()}>{(part) => (typeof part === "string" ? part : <a href={part.href}>{part.label}</a>)}</For>
    </text>
  )
}
