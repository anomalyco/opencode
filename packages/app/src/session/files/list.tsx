import { FileIcon } from "@opencode-ai/ui/file-icon"
import "@opencode-ai/ui/file-tree.css"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { kindChange, kindLabel, syncFileTreeV2Width, type Kind } from "@/session/files/file-tree-v2"
import { normalizePath } from "@/session/review/review-diff-kinds"
import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual"
import { virtualScrollElement } from "@/session/files/virtual-scroll"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useOpenInApp } from "@/session/files/open-in-app"
import { OpenInAppContextMenuV2 } from "@/session/files/open-in-app-button"
import { resolveOpenInAppPath } from "@/session/files/open-in-app-path"
import { usePlatform } from "@/runtime/platform/platform"

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
export function SessionFileList(props: {
  files: readonly string[]
  active?: string
  highlighted?: string
  kinds?: ReadonlyMap<string, Kind>
  id?: string
  role?: "listbox"
  optionID?: (path: string) => string
  onFileClick: (path: string) => void
  onFileDoubleClick?: (path: string) => void
}) {
  const location = useWorkspaceLocation()
  const platform = usePlatform()
  const openIn = platform.platform === "desktop" ? useOpenInApp({ path: () => location().directory }) : undefined
  const active = () => normalizePath(props.active ?? "")
  const highlighted = () => normalizePath(props.highlighted ?? "")
  const normalized = createMemo(() => props.files.map(normalizePath))
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [focused, setFocused] = createSignal<string>()
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return props.files.length
    },
    getScrollElement: () => virtualScrollElement(root()),
    initialRect: { width: 0, height: 600 },
    estimateSize: () => 28,
    gap: 2,
    overscan: 10,
    get getItemKey() {
      const files = props.files
      return (index: number) => files[index] ?? index
    },
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      const path = focused()
      const index = path ? props.files.indexOf(path) : -1
      if (index < 0 || indexes.includes(index)) return indexes
      return [...indexes, index].sort((a, b) => a - b)
    },
  })

  createEffect(() => {
    const index = normalized().indexOf(highlighted())
    if (index < 0) return
    queueMicrotask(() => {
      if (virtualizer.range && index >= virtualizer.range.startIndex && index <= virtualizer.range.endIndex) return
      virtualizer.scrollToIndex(index, { align: "auto" })
    })
  })
  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )
  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => item.key))

  createEffect(() => {
    normalized()
    const element = root()
    if (!element) return
    element.style.removeProperty("width")
    syncFileTreeV2Width(element)
  })

  createEffect(() => {
    virtualRowKeys()
    syncFileTreeV2Width(root())
  })

  return (
    <div
      ref={setRoot}
      id={props.id}
      role={props.role}
      data-component="file-tree-v2"
      data-total-rows={props.files.length}
      style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}
    >
      <For each={virtualRowKeys()}>
        {(key) => {
          const path = key as string
          const value = normalizePath(path)
          const selected = () => (highlighted() ? highlighted() === value : active() === value)
          const highlightedRow = () => highlighted() === value
          const kind = () => props.kinds?.get(value)
          const directory = () => (value.includes("/") ? getDirectory(value) : undefined)
          const filename = () => getFilename(value)
          return (
            <Show when={virtualItemByKey().get(key)}>
              {(item) => (
                <div
                  style={{
                    position: "absolute",
                    top: "0",
                    "inset-inline-start": "0",
                    width: "100%",
                    "min-width": "max-content",
                    height: `${item().size}px`,
                    transform: `translateY(${item().start}px)`,
                  }}
                >
                  <OpenInAppContextMenuV2 state={openIn} path={() => resolveOpenInAppPath(location().directory, path)}>
                    <button
                      type="button"
                      id={props.optionID?.(path)}
                      role={props.role ? "option" : undefined}
                      aria-selected={props.role ? selected() : undefined}
                      data-slot="file-tree-v2-row"
                      data-path={path}
                      data-selected={selected() ? "" : undefined}
                      data-highlighted={highlightedRow() ? "" : undefined}
                      style="padding-inline-start: 8px"
                      onFocus={() => setFocused(path)}
                      onBlur={() => setFocused(undefined)}
                      onClick={() => props.onFileClick(path)}
                      onDblClick={() => props.onFileDoubleClick?.(path)}
                    >
                      <span class="filetree-iconpair size-4">
                        <FileIcon node={{ path, type: "file" }} class="size-4 filetree-icon filetree-icon--color" />
                        <FileIcon node={{ path, type: "file" }} class="size-4 filetree-icon filetree-icon--mono" mono />
                      </span>
                      <span data-slot="file-tree-v2-label" class="flex flex-1 shrink-0 items-center whitespace-nowrap">
                        <Show when={directory()}>
                          {(value) => <span class="text-12-medium text-text-muted shrink-0">{value()}</span>}
                        </Show>
                        <span class="text-12-medium text-text-base shrink-0">{filename()}</span>
                      </span>
                      <Show when={kind()}>
                        {(value) => (
                          <span data-slot="file-tree-v2-change" data-change={kindChange(value())}>
                            {kindLabel(value())}
                          </span>
                        )}
                      </Show>
                    </button>
                  </OpenInAppContextMenuV2>
                </div>
              )}
            </Show>
          )
        }}
      </For>
    </div>
  )
}
