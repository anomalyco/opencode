import { type FileContents, FileDiff, type DiffLineAnnotation, FileDiffOptions } from "@pierre/precision-diffs"
import { PreloadMultiFileDiffResult } from "@pierre/precision-diffs/ssr"
import { ComponentProps, createEffect, onCleanup, onMount, Show, splitProps } from "solid-js"
import { isServer } from "solid-js/web"
import { createDefaultOptions, styleVariables } from "./pierre"

export type DiffProps<T = {}> = FileDiffOptions<T> & {
  preloadedDiff?: PreloadMultiFileDiffResult<T>
  before: FileContents
  after: FileContents
  annotations?: DiffLineAnnotation<T>[]
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

// interface ThreadMetadata {
//   threadId: string
// }
//
//

export function Diff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  let fileDiffRef!: HTMLElement
  const [local, others] = splitProps(props, ["before", "after", "class", "classList", "annotations"])

  let fileDiffInstance: FileDiff<T> | undefined
  const cleanupFunctions: Array<() => void> = []

  createEffect(() => {
    if (props.preloadedDiff) return
    container.innerHTML = ""
    if (!fileDiffInstance) {
      fileDiffInstance = new FileDiff<T>({
        ...createDefaultOptions(props.diffStyle),
        ...others,
        ...(props.preloadedDiff ?? {}),
      })
    }
    fileDiffInstance.render({
      oldFile: local.before,
      newFile: local.after,
      lineAnnotations: local.annotations,
      containerWrapper: container,
    })
  })

  onMount(() => {
    if (isServer || !props.preloadedDiff) return
    fileDiffInstance = new FileDiff<T>({
      ...createDefaultOptions(props.diffStyle),
      ...others,
      ...(props.preloadedDiff ?? {}),
    })
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
      <file-diff ref={fileDiffRef} id="ssr-diff">
        <Show when={isServer && props.preloadedDiff}>
          {(preloadedDiff) => <template shadowrootmode="open" innerHTML={preloadedDiff().prerenderedHTML} />}
        </Show>
      </file-diff>
    </div>
  )
}
