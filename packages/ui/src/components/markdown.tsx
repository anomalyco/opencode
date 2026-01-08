import { useMarked } from "../context/marked"
import { checksum } from "@opencode-ai/util/encode"
import { ComponentProps, createResource, splitProps } from "solid-js"

type Entry = {
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, Entry>()

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, ["text", "cacheKey", "class", "classList"])
  const marked = useMarked()
  const [html] = createResource(
    () => local.text,
    async (markdown) => {
      const hash = checksum(markdown)
      const key = local.cacheKey ?? hash

      if (key && hash) {
        const cached = cache.get(key)
        if (cached && cached.hash === hash) {
          touch(key, cached)
          return cached.html
        }
      }

      const next = await marked.parse(markdown)
      if (key && hash) touch(key, { hash, html: next })
      return next
    },
    { initialValue: "" },
  )
  return (
    <div
      data-component="markdown"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      innerHTML={html.latest}
      {...others}
    />
  )
}
