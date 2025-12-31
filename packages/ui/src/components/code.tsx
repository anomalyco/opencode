import { type FileContents, File, FileOptions, LineAnnotation } from "@pierre/diffs"
import { ComponentProps, createEffect, createMemo, splitProps } from "solid-js"
import { createDefaultOptions, styleVariables } from "../pierre"
import { getWorkerPool } from "../pierre/worker"

export type CodeProps<T = {}> = FileOptions<T> & {
  file: FileContents
  annotations?: LineAnnotation<T>[]
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

export function Code<T>(props: CodeProps<T>) {
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["file", "class", "classList", "annotations"])

  const file = createMemo(
    () =>
      new File<T>(
        {
          ...createDefaultOptions<T>("unified"),
          ...others,
        },
        getWorkerPool("unified"),
      ),
  )

  createEffect(() => {
    container.innerHTML = ""
    file().render({
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
