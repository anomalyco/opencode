import {
  type JSX,
  onCleanup,
  splitProps,
  createEffect,
  createResource,
} from "solid-js"
import { codeToHtml } from "shiki"
import styles from "./codeblock.module.css"
import { transformerNotationDiff } from "@shikijs/transformers"

interface CodeBlockProps extends JSX.HTMLAttributes<HTMLDivElement> {
  code: string
  lang?: string
  onRendered?: () => void
}
function CodeBlock(props: CodeBlockProps) {
  const [local, rest] = splitProps(props, ["code", "lang", "onRendered"])
  let containerRef!: HTMLDivElement

  const [html] = createResource(
    () => [local.code, local.lang],
    async ([code, lang]) => {
      return (await codeToHtml(code || "", {
        lang: lang || "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
        transformers: [transformerNotationDiff()],
      })) as string
    },
  )

  onCleanup(() => {
    if (containerRef) containerRef.innerHTML = ""
  })

  createEffect(() => {
    if (html() && containerRef) {
      containerRef.innerHTML = html() as string

      local.onRendered?.()
    }
  })

  return (
    <>
      {html() ? (
        <div ref={containerRef} class={styles.codeblock} {...rest}></div>
      ) : null}
    </>
  )
}

export default CodeBlock
