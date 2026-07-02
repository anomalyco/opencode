import { FileIcon } from "@opencode-ai/ui/file-icon"
import "@opencode-ai/ui/v2/file-tree-v2.css"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { createEffect, For, Show } from "solid-js"
import { kindChange, kindLabel, type Kind } from "@/components/file-tree-v2"
import { normalizePath } from "@/pages/session/v2/review-diff-kinds"

export function SessionFileListV2(props: {
  files: readonly string[]
  active?: string
  highlighted?: string
  kinds?: ReadonlyMap<string, Kind>
  showModifiedLabel?: boolean
  onFileClick: (path: string) => void
  onFileDoubleClick?: (path: string) => void
}) {
  const active = () => normalizePath(props.active ?? "")
  const highlighted = () => normalizePath(props.highlighted ?? "")
  const showModifiedLabel = () => props.showModifiedLabel ?? false
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
      data-show-modified-label={showModifiedLabel() ? "" : undefined}
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
          const directory = () => getDirectory(normalized)
          const filename = () => getFilename(normalized)
          return (
            <button
              type="button"
              data-slot="file-tree-v2-row"
              data-selected={selected() ? "" : undefined}
              data-highlighted={highlightedRow() ? "" : undefined}
              style="padding-left: 8px"
              onClick={() => props.onFileClick(path)}
              onDblClick={() => props.onFileDoubleClick?.(path)}
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
                    {kindLabel(value(), showModifiedLabel())}
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
