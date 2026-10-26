import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import type { SelectedLineRange } from "@pierre/diffs"
import { File } from "../src/components/file"
import { normalize } from "../src/components/session-diff"

const source = (lines: number, revision = 0) =>
  Array.from(
    { length: lines },
    (_, index) => `const value${index} = ${index % 10 === 0 ? index + revision : index}\n`,
  ).join("")

const [overflow, setOverflow] = createSignal<"wrap" | "scroll">("wrap")

const [contents, setContents] = createSignal("")

const [selected, setSelected] = createSignal<SelectedLineRange | null>(null)

const [commented, setCommented] = createSignal<SelectedLineRange[]>([])

let first: Element | null = null

export const controls = {
  setOverflow,
  setSelected,
  setCommented,
  append: (line: string) => setContents((value) => value + line),
  // Keep the first Pierre host so a later check can tell an in-place update from a rebuild.
  keepHost: () => (first = document.querySelector("[data-testid='file-viewer-fixture'] diffs-container")),
  sameHost: () =>
    first !== null && first === document.querySelector("[data-testid='file-viewer-fixture'] diffs-container"),
}

function host() {
  const element = document.createElement("div")
  element.dataset.testid = "file-viewer-fixture"
  element.style.cssText =
    "position: fixed; inset: 0 auto auto 0; z-index: 1; width: 800px; height: 400px; overflow: auto"
  document.body.appendChild(element)

  return element
}

export function mountTextViewer(lines: number) {
  setContents(source(lines))
  render(
    () => (
      <File
        mode="text"
        file={{ name: "a.ts", contents: contents() }}
        overflow={overflow()}
        enableLineSelection
        selectedLines={selected()}
        commentedLines={commented()}
      />
    ),
    host(),
  )
}

export function mountDiffViewer(lines: number) {
  const view = normalize({ file: "a.ts", before: source(lines), after: source(lines, 1), additions: 0, deletions: 0 })
  render(
    () => (
      <File
        mode="diff"
        fileDiff={view.fileDiff}
        diffStyle="unified"
        expandUnchanged
        enableLineSelection
        selectedLines={selected()}
      />
    ),
    host(),
  )
}
