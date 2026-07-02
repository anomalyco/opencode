import { FileIcon } from "@opencode-ai/ui/file-icon"
import "@opencode-ai/ui/v2/file-tree-v2.css"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { createEffect, For, Show } from "solid-js"
import { kindChange, kindLabel, type Kind } from "@/components/file-tree-v2"
import { normalizePath } from "@/pages/session/v2/review-diff-kinds"

// Drives the highlight/selection of the flat search-result list from the filter
// input's keyboard events.
export function applyFileListKeyDown(
  event: KeyboardEvent,
  files: readonly string[],
  highlighted: string | undefined,
  options: { onHighlight: (path: string) => void; onSelect: (path: string) => void },
) {
  if (files.length === 0) return

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const currentIndex = highlighted ? files.indexOf(highlighted) : -1
    const delta = event.key === "ArrowDown" ? 1 : -1
    const start = currentIndex === -1 ? (delta > 0 ? 0 : files.length - 1) : currentIndex + delta
    const index = Math.max(0, Math.min(files.length - 1, start))
    options.onHighlight(files[index]!)
    event.preventDefault()
    return
  }

  if (event.key !== "Enter") return
  const target = highlighted ?? files[0]
  if (!target) return
  options.onSelect(target)
  event.preventDefault()
}

// Flat variant of FileTreeV2 for filtered results: reuses its data-component and
// row data-slots on purpose so file-tree-v2.css styles both. data-highlighted has
// no CSS of its own — it folds into data-selected below and only exists as the
// scrollIntoView query hook.
export function SessionFileListV2(props: {
  files: readonly string[]
  active?: string
  highlighted?: string
  kinds?: ReadonlyMap<string, Kind>
  onFileClick: (path: string) => void
}) {
  const active = () => normalizePath(props.active ?? "")
  const highlighted = () => normalizePath(props.highlighted ?? "")
  let rootRef: HTMLDivElement | undefined

  createEffect(() => {
    highlighted()
    if (!rootRef) return
    queueMicrotask(() => {
      const row = rootRef?.querySelector<HTMLElement>('[data-slot="file-tree-v2-row"][data-highlighted]')
      row?.scrollIntoView({ block: "nearest" })
    })
  })

  return (
    <div
      ref={(el) => {
        rootRef = el
      }}
      data-component="file-tree-v2"
    >
      <For each={props.files}>
        {(path) => {
          const normalized = normalizePath(path)
          const selected = () => {
            if (highlighted()) return highlighted() === normalized
            return active() === normalized
          }
          const highlightedRow = () => highlighted() === normalized
          const kind = () => props.kinds?.get(normalized)
          const directory = () => (normalized.includes("/") ? getDirectory(normalized) : undefined)
          const filename = () => getFilename(normalized)
          return (
            <button
              type="button"
              data-slot="file-tree-v2-row"
              data-selected={selected() ? "" : undefined}
              data-highlighted={highlightedRow() ? "" : undefined}
              style="padding-left: 8px"
              onClick={() => props.onFileClick(path)}
            >
              <span class="filetree-iconpair size-4">
                <FileIcon node={{ path, type: "file" }} class="size-4 filetree-icon filetree-icon--color" />
                <FileIcon node={{ path, type: "file" }} class="size-4 filetree-icon filetree-icon--mono" mono />
              </span>
              <span class="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap">
                <Show when={directory()}>
                  {(value) => <span class="text-12-medium text-text-muted truncate min-w-0 shrink">{value()}</span>}
                </Show>
                <span class="text-12-medium text-text-base truncate min-w-0 shrink-0">{filename()}</span>
              </span>
              <Show when={kind()}>
                {(value) => (
                  <span data-slot="file-tree-v2-change" data-change={kindChange(value())}>
                    {kindLabel(value())}
                  </span>
                )}
              </Show>
            </button>
          )
        }}
      </For>
    </div>
  )
}
