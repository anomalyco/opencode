import { useMarked } from "../context/marked"
import { ComponentProps, createResource, splitProps } from "solid-js"

function strip(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^<([A-Za-z]\w*)>/)
  if (!match) return text

  const tagName = match[1]
  const closingTag = `</${tagName}>`
  if (trimmed.endsWith(closingTag)) {
    const content = trimmed.slice(match[0].length, -closingTag.length)
    return content.trim()
  }

  return text
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
    () => strip(local.text),
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
