import { FileDiff } from "@pierre/diffs"
import { createEffect, createMemo, onCleanup, splitProps } from "solid-js"
import { createDefaultOptions, type DiffProps, styleVariables } from "../pierre"
import { workerPool } from "../pierre/worker"

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
        workerPool,
      ),
  )

  const cleanupFunctions: Array<() => void> = []

  createEffect(() => {
    container.innerHTML = ""
    fileDiff().render({
      oldFile: local.before,
      newFile: local.after,
      lineAnnotations: local.annotations,
      containerWrapper: container,
    })
  })

  onCleanup(() => {
    // Clean up FileDiff event handlers and dispose SolidJS components
    fileDiff()?.cleanUp()
    cleanupFunctions.forEach((dispose) => dispose())
  })

  return <div data-component="diff" style={styleVariables} ref={container} />
}
