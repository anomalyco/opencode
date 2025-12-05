import { FileDiff } from "@pierre/precision-diffs"
import { getOrCreateWorkerPoolSingleton } from "@pierre/precision-diffs/worker"
import { createEffect, onCleanup, splitProps } from "solid-js"
import { createDefaultOptions, type DiffProps, styleVariables } from "../pierre"
import { workerFactory } from "../pierre/worker"

const workerPool = getOrCreateWorkerPoolSingleton({
  poolOptions: {
    workerFactory,
    // poolSize defaults to 8. More workers = more parallelism but
    // also more memory. Too many can actually slow things down.
    // poolSize: 8,
  },
  highlighterOptions: {
    theme: "OpenCode",
    // Optionally preload languages to avoid lazy-loading delays
    // langs: ["typescript", "javascript", "css", "html"],
  },
})

// interface ThreadMetadata {
//   threadId: string
// }
//
//

export function Diff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["before", "after", "class", "classList", "annotations"])

  let fileDiffInstance: FileDiff<T> | undefined
  const cleanupFunctions: Array<() => void> = []

  createEffect(() => {
    container.innerHTML = ""
    if (!fileDiffInstance) {
      fileDiffInstance = new FileDiff<T>(
        {
          ...createDefaultOptions(props.diffStyle),
          ...others,
        },
        workerPool,
      )
    }
    fileDiffInstance.render({
      oldFile: local.before,
      newFile: local.after,
      lineAnnotations: local.annotations,
      containerWrapper: container,
    })
  })

  onCleanup(() => {
    // Clean up FileDiff event handlers and dispose SolidJS components
    fileDiffInstance?.cleanUp()
    cleanupFunctions.forEach((dispose) => dispose())
  })

  return <div data-component="diff" style={styleVariables} ref={container} />
}
