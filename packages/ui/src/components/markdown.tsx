import { useMarked } from "../context/marked"
import { ComponentProps, createResource, splitProps } from "solid-js"

function strip(text: string): string {
  const wrappedRe = /^\s*<([A-Za-z]\w*)>\s*([\s\S]*?)\s*<\/\1>\s*$/
  const match = text.match(wrappedRe)
  return match ? match[2] : text
}

function removeParensAroundFileRefs(text: string): string {
  // Remove parentheses around inline code that looks like a file reference
  // Matches: (`path/to/file.ext`) or (`path/to/file.ext:1-10`) or (`file.ext:42`)
  return text.replace(/\(\s*(`[^`]+\.[a-zA-Z0-9]+(?::\d+(?:-\d+)?)?`)\s*\)/g, "$1")
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, ["text", "class", "classList"])
  const marked = useMarked()
  const [html] = createResource(
    () => removeParensAroundFileRefs(strip(local.text)),
    async (markdown) => {
      return marked.parse(markdown)
    },
  )
  return (
    <div
      data-component="markdown"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      innerHTML={html()}
      {...others}
    />
  )
}
