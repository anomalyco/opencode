import { useMarked } from "../context/marked"
import { ComponentProps, createResource, splitProps } from "solid-js"

function strip(text: string): string {
  const wrappedRe = /^\s*<([A-Za-z]\w*)>\s*([\s\S]*?)\s*<\/\1>\s*$/
  const match = text.match(wrappedRe)
  return match ? match[2] : text
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
