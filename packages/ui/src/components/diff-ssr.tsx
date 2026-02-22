import { DIFFS_TAG_NAME, FileDiff, type SelectedLineRange, VirtualizedFileDiff } from "@pierre/diffs"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { createEffect, onCleanup, onMount, Show, splitProps } from "solid-js"
import { Dynamic, isServer } from "solid-js/web"
import { createDefaultOptions, styleVariables, type DiffProps } from "../pierre"
import { findDiffSide, markCommentedDiffLines } from "../pierre/commented-lines"
import { acquireVirtualizer, virtualMetrics } from "../pierre/virtualizer"
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
  let sharedVirtualizer: NonNullable<ReturnType<typeof acquireVirtualizer>> | undefined
  const cleanupFunctions: Array<() => void> = []

  const getRoot = () => fileDiffRef?.shadowRoot ?? undefined

  const getVirtualizer = () => {
    if (sharedVirtualizer) return sharedVirtualizer.virtualizer

    const result = acquireVirtualizer(container)
    if (!result) return

    sharedVirtualizer = result
    return result.virtualizer
  }

  const applyScheme = () => {
    const scheme = document.documentElement.dataset.colorScheme
    if (scheme === "dark" || scheme === "light") {
      fileDiffRef.dataset.colorScheme = scheme
      return
    }

    fileDiffRef.removeAttribute("data-color-scheme")
  }

  const lineIndex = (split: boolean, element: HTMLElement) => {
    const raw = element.dataset.lineIndex
    if (!raw) return
    const values = raw
      .split(",")
      .map((value) => parseInt(value, 10))
      .filter((value) => !Number.isNaN(value))
    if (values.length === 0) return
    if (!split) return values[0]
    if (values.length === 2) return values[1]
    return values[0]
  }

  const rowIndex = (root: ShadowRoot, split: boolean, line: number, side: "additions" | "deletions" | undefined) => {
    const nodes = Array.from(root.querySelectorAll(`[data-line="${line}"], [data-alt-line="${line}"]`)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    if (nodes.length === 0) return

    const targetSide = side ?? "additions"

    for (const node of nodes) {
      if (findDiffSide(node) === targetSide) return lineIndex(split, node)
      if (parseInt(node.dataset.altLine ?? "", 10) === line) return lineIndex(split, node)
    }
  }

  const fixSelection = (range: SelectedLineRange | null) => {
    if (!range) return range
    const root = getRoot()
    if (!root) return

    const diffs = root.querySelector("[data-diff]")
    if (!(diffs instanceof HTMLElement)) return

    const split = diffs.dataset.diffType === "split"

    const start = rowIndex(root, split, range.start, range.side)
    const end = rowIndex(root, split, range.end, range.endSide ?? range.side)

    if (start === undefined || end === undefined) {
      if (root.querySelector("[data-line], [data-alt-line]") == null) return
      return null
    }
    if (start <= end) return range

    const side = range.endSide ?? range.side
    const swapped: SelectedLineRange = {
      start: range.end,
      end: range.start,
    }
    if (side) swapped.side = side
    if (range.endSide && range.side) swapped.endSide = range.side

    return swapped
  }

  const setSelectedLines = (range: SelectedLineRange | null, attempt = 0) => {
    const diff = fileDiffInstance
    if (!diff) return

    const fixed = fixSelection(range)
    if (fixed === undefined) {
      if (attempt >= 120) return
      requestAnimationFrame(() => setSelectedLines(range, attempt + 1))
      return
    }

    diff.setSelectedLines(fixed)
  }

  onMount(() => {
    if (isServer || !props.preloadedDiff) return

    applyScheme()

    if (typeof MutationObserver !== "undefined") {
      const root = document.documentElement
      const monitor = new MutationObserver(() => applyScheme())
      monitor.observe(root, { attributes: true, attributeFilter: ["data-color-scheme"] })
      onCleanup(() => monitor.disconnect())
    }

    const virtualizer = getVirtualizer()

    fileDiffInstance = virtualizer
      ? new VirtualizedFileDiff<T>(
          {
            ...createDefaultOptions(props.diffStyle),
            ...others,
            ...props.preloadedDiff,
          },
          virtualizer,
          virtualMetrics,
          workerPool,
        )
      : new FileDiff<T>(
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

    setSelectedLines(local.selectedLines ?? null)

    createEffect(() => {
      const diff = fileDiffInstance
      if (!diff) return
      diff.setLineAnnotations(local.annotations ?? [])
      diff.rerender()
    })

    createEffect(() => {
      setSelectedLines(local.selectedLines ?? null)
    })

    createEffect(() => {
      const ranges = local.commentedLines ?? []
      requestAnimationFrame(() => {
        const root = getRoot()
        if (!root) return
        markCommentedDiffLines(root, ranges)
      })
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
    sharedVirtualizer?.release()
    sharedVirtualizer = undefined
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
