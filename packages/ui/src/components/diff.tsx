import { FileDiff } from "@pierre/diffs"
import { createEffect, createMemo, onCleanup, splitProps, createSignal } from "solid-js"
import { createDefaultOptions, type DiffProps, styleVariables } from "../pierre"
import { workerPool } from "../pierre/worker"
import { Spinner } from "./spinner"
import { Show } from "solid-js"

// interface ThreadMetadata {
//   threadId: string
// }
//
//

export function Diff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, ["before", "after", "class", "classList", "annotations"])
  const [isRendering, setIsRendering] = createSignal(false)

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
    setIsRendering(true)

    try {
      container.innerHTML = ""
      fileDiff().render({
        oldFile: local.before,
        newFile: local.after,
        lineAnnotations: local.annotations,
        containerWrapper: container,
      })
    } finally {
      setIsRendering(false)
    }
  })

  onCleanup(() => {
    // Clean up FileDiff event handlers and dispose SolidJS components
    fileDiff()?.cleanUp()
    cleanupFunctions.forEach((dispose) => dispose())
  })

  return (
    <div data-component="diff" style={styleVariables}>
      <Show when={isRendering()}>
        <div class="flex items-center justify-center py-8 text-text-weaker">
          <Spinner class="mr-2" />
          Rendering diff...
        </div>
      </Show>
      <div ref={container} />
    </div>
  )
}
