import { type JSX, splitProps, createResource } from "solid-js"
import { marked } from "marked"
import markedShiki from "marked-shiki"
import { codeToHtml } from "shiki"
import { transformerNotationDiff } from "@shikijs/transformers"
import styles from "./markdownview.module.css"

interface MarkdownViewProps extends JSX.HTMLAttributes<HTMLDivElement> {
  markdown: string
}

const markedWithShiki = marked.use(
  markedShiki({
    highlight(code, lang) {
      return codeToHtml(code, {
        lang: lang || "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
        transformers: [transformerNotationDiff()],
      })
    },
  }),
)

function MarkdownView(props: MarkdownViewProps) {
  const [local, rest] = splitProps(props, ["markdown"])
  const [html] = createResource(
    () => local.markdown,
    async (markdown) => {
      return markedWithShiki.parse(markdown)
    },
  )

  return <div innerHTML={html()} class={styles["markdown-body"]} {...rest} />
}

export default MarkdownView
