import { marked } from "marked"
import { codeToHtml } from "shiki"
import markedShiki from "marked-shiki"
import { createOverflow } from "./common"
import { CopyButton } from "./copy-button"
import { createResource, createSignal } from "solid-js"
import { transformerNotationDiff } from "@shikijs/transformers"
import style from "./content-markdown.module.css"

const markedWithShiki = marked.use(
  {
    renderer: {
      link({ href, title, text }) {
        const titleAttr = title ? ` title="${title}"` : ""
        return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
      },
    },
  },
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

interface Props {
  text: string
  expand?: boolean
  highlight?: boolean
}
export function ContentMarkdown(props: Props) {
  const [html] = createResource(
    () => strip(props.text),
    async (markdown) => {
      return markedWithShiki.parse(markdown)
    },
  )
  const [expanded, setExpanded] = createSignal(false)
  const overflow = createOverflow()

  return (
    <div
      class={style.root}
      data-highlight={props.highlight === true ? true : undefined}
      data-expanded={expanded() || props.expand === true ? true : undefined}
    >
      <div data-slot="markdown" ref={overflow.ref} innerHTML={html()} />

      {!props.expand && overflow.status && (
        <button
          type="button"
          data-component="text-button"
          data-slot="expand-button"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? "Show less" : "Show more"}
        </button>
      )}
      <CopyButton text={props.text} />
    </div>
  )
}

function strip(text: string): string {
  const wrappedRe = /^\s*<([A-Za-z]\w*)>\s*([\s\S]*?)\s*<\/\1>\s*$/
  const match = text.match(wrappedRe)
  return match ? match[2] : text
}
