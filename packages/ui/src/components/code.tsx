import { type FileContents, File, FileOptions, LineAnnotation, type SelectedLineRange } from "@pierre/diffs"
import { ComponentProps, createEffect, createMemo, onCleanup, splitProps } from "solid-js"
import { createDefaultOptions, styleVariables } from "../pierre"
import { getWorkerPool } from "../pierre/worker"

type SelectionSide = "additions" | "deletions"

export type CodeProps<T = {}> = FileOptions<T> & {
  file: FileContents
  annotations?: LineAnnotation<T>[]
  selectedLines?: SelectedLineRange | null
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

function findElement(node: Node | null): HTMLElement | undefined {
  if (!node) return
  if (node instanceof HTMLElement) return node
  return node.parentElement ?? undefined
}

function findLineNumber(node: Node | null): number | undefined {
  const element = findElement(node)
  if (!element) return

  const line = element.closest("[data-line]")
  if (!(line instanceof HTMLElement)) return

  const value = parseInt(line.dataset.line ?? "", 10)
  if (Number.isNaN(value)) return

  return value
}

function findSide(node: Node | null): SelectionSide | undefined {
  const element = findElement(node)
  if (!element) return

  const code = element.closest("[data-code]")
  if (!(code instanceof HTMLElement)) return

  if (code.hasAttribute("data-deletions")) return "deletions"
  return "additions"
}

export function Code<T>(props: CodeProps<T>) {
  let container!: HTMLDivElement

  const [local, others] = splitProps(props, ["file", "class", "classList", "annotations", "selectedLines"])

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

  const getRoot = () => {
    const host = container.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return

    const root = host.shadowRoot
    if (!root) return

    return root
  }

  const handleMouseUp = () => {
    if (props.enableLineSelection !== true) return

    const root = getRoot()
    if (!root) return

    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    const anchor = selection.anchorNode
    const focus = selection.focusNode
    if (!anchor || !focus) return
    if (!root.contains(anchor) || !root.contains(focus)) return

    const start = findLineNumber(anchor)
    const end = findLineNumber(focus)
    if (start === undefined || end === undefined) return

    const startSide = findSide(anchor)
    const endSide = findSide(focus)
    const side = startSide ?? endSide

    const range: SelectedLineRange = {
      start,
      end,
    }

    if (side) range.side = side
    if (endSide && side && endSide !== side) range.endSide = endSide

    file().setSelectedLines(range)
  }

  createEffect(() => {
    const current = file()

    onCleanup(() => {
      current.cleanUp()
    })
  })

  createEffect(() => {
    container.innerHTML = ""
    file().render({
      file: local.file,
      lineAnnotations: local.annotations,
      containerWrapper: container,
    })
  })

  createEffect(() => {
    file().setSelectedLines(local.selectedLines ?? null)
  })

  createEffect(() => {
    if (props.enableLineSelection !== true) return

    container.addEventListener("mouseup", handleMouseUp)

    onCleanup(() => {
      container.removeEventListener("mouseup", handleMouseUp)
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
