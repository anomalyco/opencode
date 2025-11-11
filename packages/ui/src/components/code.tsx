import { type FileContents, File, FileOptions, LineAnnotation } from "@pierre/precision-diffs"
import { ComponentProps, createEffect, splitProps } from "solid-js"

export type CodeProps<T = {}> = FileOptions<T> & {
  file: FileContents
  annotations?: LineAnnotation<T>[]
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

export function Code<T>(props: CodeProps<T>) {
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["file", "class", "classList", "annotations"])

  createEffect(() => {
    const instance = new File<T>({
      theme: "OpenCode",
      overflow: "wrap", // or 'scroll'
      themeType: "system", // 'system', 'light', or 'dark'
      disableFileHeader: true,
      disableLineNumbers: false, // optional
      // lang: 'typescript', // optional - auto-detected from filename if not provided
      ...others,
    })

    container.innerHTML = ""
    instance.render({
      file: local.file,
      lineAnnotations: local.annotations,
      containerWrapper: container,
    })
  })

  return (
    <div
      data-component="code"
      style={{
        "--pjs-font-family": "var(--font-family-mono)",
        "--pjs-font-size": "var(--font-size-small)",
        "--pjs-line-height": "24px",
        "--pjs-tab-size": 2,
        "--pjs-font-features": "var(--font-family-mono--font-feature-settings)",
        "--pjs-header-font-family": "var(--font-family-sans)",
        "--pjs-gap-block": 0,
        "--pjs-min-number-column-width": "4ch",
      }}
      classList={{
        ...(local.classList || {}),
        [local.class ?? ""]: !!local.class,
      }}
      ref={container}
    />
  )
}
