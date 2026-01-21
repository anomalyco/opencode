import { DIFFS_TAG_NAME, FileDiff } from "@pierre/diffs"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { onCleanup, onMount, Show, splitProps } from "solid-js"
import { Dynamic, isServer } from "solid-js/web"
import { createDefaultOptions, styleVariables, type DiffProps } from "../pierre"
import { useWorkerPool } from "../context/worker-pool"

export type SSRDiffProps<T = {}> = DiffProps<T> & {
  preloadedDiff: PreloadMultiFileDiffResult<T>
}

export function Diff<T>(props: SSRDiffProps<T>) {
  let container!: HTMLDivElement
  let fileDiffRef!: HTMLElement
  const [local, others] = splitProps(props, ["before", "after", "class", "classList", "annotations"])
  const workerPool = useWorkerPool(props.diffStyle)

  let fileDiffInstance: FileDiff<T> | undefined
  const cleanupFunctions: Array<() => void> = []

  onMount(() => {
    if (isServer || !props.preloadedDiff) return
    fileDiffInstance = new FileDiff<T>(
      {
        ...createDefaultOptions(props.diffStyle),
        ...others,
        ...props.preloadedDiff,
      },
      workerPool,
    )
    // @ts-expect-error - fileContainer is private but needed for SSR hydration
    fileDiffInstance.fileContainer = fileDiffRef
    fileDiffInstance.hydrate({
      oldFile: local.before,
      newFile: local.after,
      lineAnnotations: local.annotations,
      fileContainer: fileDiffRef,
      containerWrapper: container,
    })

    // Hydrate annotation slots with interactive SolidJS components
    // if (props.annotations.length > 0 && props.renderAnnotation != null) {
    //   for (const annotation of props.annotations) {
    //     const slotName = `annotation-${annotation.side}-${annotation.lineNumber}`;
    //     const slotElement = fileDiffRef.querySelector(
    //       `[slot="${slotName}"]`
    //     ) as HTMLElement;
    //
    //     if (slotElement != null) {
    //       // Clear the static server-rendered content from the slot
    //       slotElement.innerHTML = '';
    //
    //       // Mount a fresh SolidJS component into this slot using render().
    //       // This enables full SolidJS reactivity (signals, effects, etc.)
    //       const dispose = render(
    //         () => props.renderAnnotation!(annotation),
    //         slotElement
    //       );
    //       cleanupFunctions.push(dispose);
    //     }
    //   }
    // }
  })

  onCleanup(() => {
    // Clean up FileDiff event handlers and dispose SolidJS components
    fileDiffInstance?.cleanUp()
    cleanupFunctions.forEach((dispose) => dispose())
  })

  return (
    <div data-component="diff" style={styleVariables} ref={container}>
      <Dynamic component={DIFFS_TAG_NAME} ref={fileDiffRef} id="ssr-diff">
        <Show when={isServer}>
          <template shadowrootmode="open" innerHTML={props.preloadedDiff.prerenderedHTML} />
        </Show>
      </Dynamic>
    </div>
  )
}
