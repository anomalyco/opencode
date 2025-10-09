import { useMarked } from "@/context"
import { createResource } from "solid-js"

function strip(text: string): string {
  const wrappedRe = /^\s*<([A-Za-z]\w*)>\s*([\s\S]*?)\s*<\/\1>\s*$/
  const match = text.match(wrappedRe)
  return match ? match[2] : text
}
export function Markdown(props: { text: string; class?: string }) {
  const marked = useMarked()
  const [html] = createResource(
    () => strip(props.text),
    async (markdown) => {
      return marked.parse(markdown)
    },
  )
  return (
    <div
      class={`min-w-0 max-w-full text-xs overflow-auto no-scrollbar prose ${props.class ?? ""}`}
      innerHTML={html()}
    />
  )
}
