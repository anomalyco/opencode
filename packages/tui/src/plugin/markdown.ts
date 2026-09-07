import { createMarkdownCodeBlockRenderer, type MarkdownCodeBlockRenderer } from "@opentui/core"
import { isShallowEqual } from "remeda"
import { createMemo } from "solid-js"

export function createMarkdownRenderer(
  sources: () => ReadonlyArray<Readonly<Record<string, MarkdownCodeBlockRenderer>>>,
) {
  // Changing renderNode makes OpenTUI destroy and rebuild every Markdown block.
  // Only invalidate it when the effective last-wins language handlers change.
  const renderers = createMemo(
    () => Object.fromEntries(sources().flatMap((source) => Object.entries(source))),
    undefined,
    { equals: isShallowEqual },
  )
  return createMemo(() =>
    Object.keys(renderers()).length === 0 ? undefined : createMarkdownCodeBlockRenderer(renderers()),
  )
}
