import {
  type JSX,
  splitProps,
  createResource,
} from "solid-js"
import { codeToHtml } from "shiki"
import styles from "./codeblock.module.css"
import { transformerNotationDiff } from "@shikijs/transformers"

interface CodeBlockProps extends JSX.HTMLAttributes<HTMLDivElement> {
  code: string
  lang?: string
}
function CodeBlock(props: CodeBlockProps) {
  const [local, rest] = splitProps(props, ["code", "lang"])

  const [html] = createResource(
    () => [local.code, local.lang],
    async ([code, lang]) => {
      // TODO: For testing delays
      // await new Promise((resolve) => setTimeout(resolve, 3000))
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

  return <div innerHTML={html()} class={styles.codeblock} {...rest}></div >
}

export default CodeBlock
