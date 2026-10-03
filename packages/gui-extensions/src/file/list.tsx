import { createMemo, createSignal, For, Show } from "solid-js"
import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual"
import { FileIcon } from "@opencode/ui/file-icon"
import { getDirectory, getFilename } from "@opencode/util/path"
import type { ChangeKind } from "../review/contract"
import { createKeyed, useExtension, type MountedSession, type SessionScreen } from "../sdk"
import { OpenInAppContextMenuV2, useOpenInApp } from "./open-in-app"
import { resolveOpenInAppPath } from "./path"
import { normalizeFileTreeV2Path } from "./tree-model"
import { kindChange, kindLabel, syncFileTreeV2Width, virtualScrollElement } from "./tree-v2"

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
export default function SessionFileList(props: {
  session: MountedSession
  screen: SessionScreen
  files: readonly string[]
  active?: string
  highlighted?: string
  kinds?: ReadonlyMap<string, ChangeKind>
  id?: string
  role?: "listbox"
  optionID?: (path: string) => string
  onFileClick: (path: string) => void
  onFileDoubleClick?: (path: string) => void
}) {
  const ctx = useExtension()

  const openIn = ctx.desktop ? useOpenInApp({ session: props.session, path: () => props.screen.file.root }) : undefined

  const active = () => normalizeFileTreeV2Path(props.active ?? "")
  const highlighted = () => normalizeFileTreeV2Path(props.highlighted ?? "")
  const normalized = createMemo(() => props.files.map(normalizeFileTreeV2Path))
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

  // Keeps the highlighted result in the virtualized viewport.
  createKeyed(
    () => {
      const index = normalized().indexOf(highlighted())

      return index < 0 ? undefined : { index }
    },
    (target) =>
      queueMicrotask(() => {
        const range = virtualizer.range

        if (range && target.index >= range.startIndex && target.index <= range.endIndex) return

        virtualizer.scrollToIndex(target.index, { align: "auto" })
      }),
  )

  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )

  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => item.key))

  // New results measure from the pane's width again; rows wider than the pane widen the list.
  createKeyed(
    () => {
      const files = normalized()
      const element = root()

      return element && { element, files }
    },
    (current) => {
      current.element.style.removeProperty("width")
      syncFileTreeV2Width(current.element)
    },
  )

  createKeyed(
    () => ({ keys: virtualRowKeys(), element: root() }),
    (current) => syncFileTreeV2Width(current.element),
  )

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
          const path = String(key)
          const value = normalizeFileTreeV2Path(path)
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
                  <OpenInAppContextMenuV2
                    state={openIn}
                    path={() => resolveOpenInAppPath(props.screen.file.root, path)}
                  >
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
