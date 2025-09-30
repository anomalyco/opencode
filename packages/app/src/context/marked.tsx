import { createContext, useContext, type ParentProps } from "solid-js"
import { useShiki } from "@/context"
import { marked } from "marked"
import markedShiki from "marked-shiki"
import { bundledLanguages, type BundledLanguage } from "shiki"

function init(highlighter: ReturnType<typeof useShiki>) {
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
}

type MarkedContext = ReturnType<typeof init>

const ctx = createContext<MarkedContext>()

export function MarkedProvider(props: ParentProps) {
  const highlighter = useShiki()
  const value = init(highlighter)
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useMarked() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useMarked must be used within a MarkedProvider")
  }
  return value
}
