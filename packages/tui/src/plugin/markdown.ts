import { createMarkdownCodeBlockRenderer, type MarkdownCodeBlockRenderer } from "@opentui/core"
import type { MarkdownPreprocessor, MarkdownPreprocessorInput } from "@opencode/plugin/tui/context"
import { isShallowEqual } from "remeda"
import { createMemo } from "solid-js"

export function createMarkdownRenderer(
  sources: () => ReadonlyArray<Readonly<Record<string, MarkdownCodeBlockRenderer>>>,
) {
  // Changing renderBlock makes OpenTUI destroy and rebuild every Markdown block.
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

export function createMarkdownPreprocessor(
  sources: () => ReadonlyArray<ReadonlyArray<MarkdownPreprocessor>>,
) {
  const preprocessors = createMemo(() => sources().flat())
  return (text: string, input: MarkdownPreprocessorInput): string => {
    let current = text
    for (const preprocess of preprocessors()) {
      try {
        const next = preprocess(current, input)
        if (typeof next === "string") current = next
      } catch {
        // Keep TUI rendering resilient if a plugin preprocessor throws.
      }
    }
    return current
  }
}
