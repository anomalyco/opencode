import { DIFFS_TAG_NAME, FileDiff, type SelectedLineRange } from "@pierre/diffs"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { createEffect, onCleanup, onMount, Show, splitProps } from "solid-js"
import { Dynamic, isServer } from "solid-js/web"
import { createDefaultOptions, styleVariables, type DiffProps } from "../pierre"
import { useWorkerPool } from "../context/worker-pool"

export type SSRDiffProps<T = {}> = DiffProps<T> & {
  preloadedDiff: PreloadMultiFileDiffResult<T>
}

export function Diff<T>(props: SSRDiffProps<T>) {
  let container!: HTMLDivElement
  let fileDiffRef!: HTMLElement
  const [local, others] = splitProps(props, [
    "before",
    "after",
    "class",
    "classList",
    "annotations",
    "selectedLines",
    "commentedLines",
  ])
  const workerPool = useWorkerPool(props.diffStyle)

  let fileDiffInstance: FileDiff<T> | undefined
  const cleanupFunctions: Array<() => void> = []

  const getRoot = () => fileDiffRef?.shadowRoot ?? undefined

  const findSide = (element: HTMLElement): "additions" | "deletions" => {
    const code = element.closest("[data-code]")
    if (!(code instanceof HTMLElement)) return "additions"
    if (code.hasAttribute("data-deletions")) return "deletions"
    return "additions"
  }

  const applyCommentedLines = (ranges: SelectedLineRange[]) => {
    const root = getRoot()
    if (!root) return

    const existing = Array.from(root.querySelectorAll("[data-comment-selected]"))
    for (const node of existing) {
      if (!(node instanceof HTMLElement)) continue
      node.removeAttribute("data-comment-selected")
    }

    for (const range of ranges) {
      const start = Math.max(1, Math.min(range.start, range.end))
      const end = Math.max(range.start, range.end)

      for (let line = start; line <= end; line++) {
        const expectedSide =
          line === end ? (range.endSide ?? range.side) : line === start ? range.side : (range.side ?? range.endSide)

        const nodes = Array.from(root.querySelectorAll(`[data-line="${line}"], [data-alt-line="${line}"]`))
        for (const node of nodes) {
          if (!(node instanceof HTMLElement)) continue
          if (expectedSide && findSide(node) !== expectedSide) continue
          node.setAttribute("data-comment-selected", "")
        }
      }
    }
  }

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

    fileDiffInstance.setSelectedLines(local.selectedLines ?? null)

    createEffect(() => {
      fileDiffInstance?.setLineAnnotations(local.annotations ?? [])
    })

    createEffect(() => {
      fileDiffInstance?.setSelectedLines(local.selectedLines ?? null)
    })

    createEffect(() => {
      const ranges = local.commentedLines ?? []
      requestAnimationFrame(() => applyCommentedLines(ranges))
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
