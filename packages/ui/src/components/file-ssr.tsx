import { DIFFS_TAG_NAME, FileDiff, VirtualizedFileDiff } from "@pierre/diffs"
import { type PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { createEffect, onCleanup, onMount, Show, splitProps } from "solid-js"
import { Dynamic, isServer } from "solid-js/web"
import { useWorkerPool } from "../context/worker-pool"
import { createDefaultOptions, styleVariables } from "../pierre"
import { markCommentedDiffLines } from "../pierre/commented-lines"
import { fixDiffSelection } from "../pierre/diff-selection"
import {
  applyViewerScheme,
  clearReadyWatcher,
  createReadyWatcher,
  notifyShadowReady,
  observeViewerScheme,
} from "../pierre/file-runtime"
import { acquireVirtualizer, virtualMetrics } from "../pierre/virtualizer"
import { File, type DiffFileProps, type FileProps } from "./file"

type SSRDiffFileProps<T> = DiffFileProps<T> & {
  preloadedDiff: PreloadMultiFileDiffResult<T>
}

function DiffSSRViewer<T>(props: SSRDiffFileProps<T>) {
  let container!: HTMLDivElement
  let fileDiffRef!: HTMLElement
  let fileDiffInstance: FileDiff<T> | undefined
  let sharedVirtualizer: NonNullable<ReturnType<typeof acquireVirtualizer>> | undefined

  const ready = createReadyWatcher()
  const workerPool = useWorkerPool(props.diffStyle)

  const [local, others] = splitProps(props, [
    "mode",
    "media",
    "before",
    "after",
    "class",
    "classList",
    "annotations",
    "selectedLines",
    "commentedLines",
    "onLineSelected",
    "onLineSelectionEnd",
    "onLineNumberSelectionEnd",
    "onRendered",
    "preloadedDiff",
  ])

  const getRoot = () => fileDiffRef?.shadowRoot ?? undefined

  const getVirtualizer = () => {
    if (sharedVirtualizer) return sharedVirtualizer.virtualizer
    const result = acquireVirtualizer(container)
    if (!result) return
    sharedVirtualizer = result
    return result.virtualizer
  }

  const setSelectedLines = (range: DiffFileProps<T>["selectedLines"], attempt = 0) => {
    const diff = fileDiffInstance
    if (!diff) return

    const fixed = fixDiffSelection(getRoot(), range ?? null)
    if (fixed === undefined) {
      if (attempt >= 120) return
      requestAnimationFrame(() => setSelectedLines(range ?? null, attempt + 1))
      return
    }

    diff.setSelectedLines(fixed)
  }

  const notifyRendered = () => {
    notifyShadowReady({
      state: ready,
      container,
      getRoot,
      isReady: (root) => root.querySelector("[data-line]") != null,
      settleFrames: 1,
      onReady: () => {
        setSelectedLines(local.selectedLines ?? null)
        local.onRendered?.()
      },
    })
  }

  onMount(() => {
    if (isServer) return

    onCleanup(observeViewerScheme(() => fileDiffRef))

    const virtualizer = getVirtualizer()
    fileDiffInstance = virtualizer
      ? new VirtualizedFileDiff<T>(
          {
            ...createDefaultOptions(props.diffStyle),
            ...others,
            ...local.preloadedDiff,
          },
          virtualizer,
          virtualMetrics,
          workerPool,
        )
      : new FileDiff<T>(
          {
            ...createDefaultOptions(props.diffStyle),
            ...others,
            ...local.preloadedDiff,
          },
          workerPool,
        )

    applyViewerScheme(fileDiffRef)

    // @ts-expect-error private field required for hydration
    fileDiffInstance.fileContainer = fileDiffRef
    fileDiffInstance.hydrate({
      oldFile: local.before,
      newFile: local.after,
      lineAnnotations: local.annotations ?? [],
      fileContainer: fileDiffRef,
      containerWrapper: container,
    })

    notifyRendered()
  })

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

  onCleanup(() => {
    clearReadyWatcher(ready)
    fileDiffInstance?.cleanUp()
    sharedVirtualizer?.release()
    sharedVirtualizer = undefined
  })

  return (
    <div
      data-component="file"
      data-mode="diff"
      style={styleVariables}
      class={local.class}
      classList={local.classList}
      ref={container}
    >
      <Dynamic component={DIFFS_TAG_NAME} ref={fileDiffRef} id="ssr-diff">
        <Show when={isServer}>
          <template shadowrootmode="open" innerHTML={local.preloadedDiff.prerenderedHTML} />
        </Show>
      </Dynamic>
    </div>
  )
}

export type FileSSRProps<T = {}> = FileProps<T>

export function FileSSR<T>(props: FileSSRProps<T>) {
  if (props.mode !== "diff" || !props.preloadedDiff) return File(props)
  return DiffSSRViewer(props as SSRDiffFileProps<T>)
}
