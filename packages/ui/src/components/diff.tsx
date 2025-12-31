import { FileDiff } from "@pierre/diffs"
import { createEffect, createMemo, onCleanup, splitProps } from "solid-js"
import { createDefaultOptions, type DiffProps, styleVariables } from "../pierre"
import { getWorkerPool } from "../pierre/worker"

// interface ThreadMetadata {
//   threadId: string
// }
//
//

export function Diff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["before", "after", "class", "classList", "annotations"])

  const fileDiff = createMemo(
    () =>
      new FileDiff<T>(
        {
          ...createDefaultOptions(props.diffStyle),
          ...others,
        },
        getWorkerPool(props.diffStyle),
      ),
  )

  createEffect(() => {
    const diff = fileDiff()
    container.innerHTML = ""
    diff.render({
      oldFile: local.before,
      newFile: local.after,
      lineAnnotations: local.annotations,
      containerWrapper: container,
    })

    onCleanup(() => {
      diff.cleanUp()
    })
  })

  return <div data-component="diff" style={styleVariables} ref={container} />
}
