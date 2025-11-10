import { marked } from "marked"
import markedShiki from "marked-shiki"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { createSimpleContext } from "./helper"
import { getSharedHighlighter } from "@pierre/precision-diffs"

const highlighter = await getSharedHighlighter({ themes: ["OpenCode"], langs: [] })

export const { use: useMarked, provider: MarkedProvider } = createSimpleContext({
  name: "Marked",
  init: () => {
    return marked.use(
      markedShiki({
        async highlight(code, lang) {
          if (!(lang in bundledLanguages)) {
            lang = "text"
          }
          if (!highlighter.getLoadedLanguages().includes(lang)) {
            await highlighter.loadLanguage(lang as BundledLanguage)
          }
          return highlighter.codeToHtml(code, {
            lang: lang || "text",
            theme: "OpenCode",
            tabindex: false,
          })
        },
      }),
    )
  },
})
