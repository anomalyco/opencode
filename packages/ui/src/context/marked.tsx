import { marked } from "marked"
import markedShiki from "marked-shiki"
import { bundledLanguages, type BundledLanguage } from "shiki"

import { createSimpleContext } from "./helper"
import { useShiki } from "./shiki"

export const { use: useMarked, provider: MarkedProvider } = createSimpleContext({
  name: "Marked",
  init: () => {
    const highlighter = useShiki()
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
            theme: "opencode",
            tabindex: false,
          })
        },
      }),
    )
  },
})
