import { type FileContents, File, FileOptions, LineAnnotation } from "@pierre/precision-diffs"
import { ComponentProps, createEffect, splitProps } from "solid-js"
import { createDefaultOptions, styleVariables } from "./pierre"

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
      ...createDefaultOptions<T>("unified"),
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
      style={styleVariables}
      classList={{
        ...(local.classList || {}),
        [local.class ?? ""]: !!local.class,
      }}
      ref={container}
    />
  )
}
