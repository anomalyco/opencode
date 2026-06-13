import { Show, For, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Icon } from "@cedric/ui/icon"
import { IconButton } from "@cedric/ui/icon-button"
import type { WorkspaceTab, WorkspaceTabType } from "@/context/workspace-tabs"

interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onNewTab: () => void
  onOpenFile: () => void
  onPin: (id: string) => void
  onUnpin: (id: string) => void
  onDuplicate: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseAll: () => void
  onReopenClosed: () => void
  canReopenClosed: boolean
}

export function WorkspaceTabBar(props: WorkspaceTabBarProps) {
  const [draggingId, setDraggingId] = createSignal<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = createSignal<number | null>(null)
  const [dragSourceIndex, setDragSourceIndex] = createSignal<number | null>(null)
  const [contextMenu, setContextMenu] = createSignal<{ id: string; x: number; y: number } | null>(null)
  const contextTab = createMemo(() => {
    const menu = contextMenu()
    if (!menu) return undefined
    return props.tabs.find((tab) => tab.id === menu.id)
  })

  const getTabIcon = (type: WorkspaceTabType) => {
    switch (type) {
      case "browser":
        return "window-cursor"
      case "file":
        return "open-file"
      case "review":
        return "review"
      case "terminal":
        return "terminal"
      case "chat":
        return "comment"
      default:
        return "open-file"
    }
  }

  const handleDragStart = (e: DragEvent, id: string, index: number) => {
    setDraggingId(id)
    setDragSourceIndex(index)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move"
      // Set a dummy data so the browser recognizes this as a valid drag
      e.dataTransfer.setData("text/plain", id)
    }
  }

  const handleDragOver = (e: DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move"
    }
    setDragOverIndex(index)
  }

  const handleDragEnter = (e: DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverIndex(index)
  }

  const handleDrop = (e: DragEvent, toIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    const fromIndex = dragSourceIndex()
    if (fromIndex !== null && fromIndex !== toIndex) {
      props.onReorder(fromIndex, toIndex)
    }
    setDraggingId(null)
    setDragOverIndex(null)
    setDragSourceIndex(null)
  }

  const handleDragEnd = () => {
    setDraggingId(null)
    setDragOverIndex(null)
    setDragSourceIndex(null)
  }

  const closeContextMenu = () => setContextMenu(null)

  const runContextAction = (action: () => void) => {
    action()
    closeContextMenu()
  }

  createEffect(() => {
    if (!contextMenu()) return

    const handleClick = () => closeContextMenu()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu()
    }

    window.addEventListener("click", handleClick)
    window.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      window.removeEventListener("click", handleClick)
      window.removeEventListener("keydown", handleKeyDown)
    })
  })

  return (
    <div class="flex items-center gap-0.5 px-2 py-1.5 border-b border-border-weaker-base bg-background-base overflow-x-auto">
      <For each={props.tabs}>
        {(tab, index) => (
          <div
            class="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-13-regular cursor-pointer transition-colors shrink-0 max-w-[160px] select-none"
            classList={{
              "bg-background-stronger text-text-base": tab.isActive,
              "text-text-weak hover:bg-background-stronger/50 hover:text-text-base": !tab.isActive,
              "opacity-50": draggingId() === tab.id,
              "border-l-2 border-l-icon-info-active": dragOverIndex() === index(),
            }}
            draggable
            onDragStart={(e) => handleDragStart(e, tab.id, index())}
            onDragOver={(e) => handleDragOver(e, index())}
            onDragEnter={(e) => handleDragEnter(e, index())}
            onDrop={(e) => handleDrop(e, index())}
            onDragEnd={handleDragEnd}
            onClick={() => props.onActivate(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setContextMenu({ id: tab.id, x: e.clientX, y: e.clientY })
            }}
          >
            <Icon
              name={getTabIcon(tab.type)}
              class="w-3.5 h-3.5 shrink-0"
              classList={{
                "text-icon-info-active": tab.type === "browser",
                "text-syntax-string": tab.type === "file",
                "text-icon-warning-base": tab.type === "review",
                "text-syntax-function": tab.type === "terminal",
                "text-syntax-type": tab.type === "chat",
              }}
            />
            <span class="truncate">{tab.title}</span>

            <Show when={!tab.isPinned}>
              <IconButton
                icon="close-small"
                variant="ghost"
                class="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onClose(tab.id)
                }}
              />
            </Show>
          </div>
        )}
      </For>

      <div class="flex items-center gap-0.5 ml-1 shrink-0">
        <IconButton
          icon="plus-small"
          variant="ghost"
          class="w-7 h-7"
          onClick={props.onNewTab}
          title="New tab"
        />
        <IconButton
          icon="open-file"
          variant="ghost"
          class="w-7 h-7"
          onClick={props.onOpenFile}
          title="Open file"
        />
      </div>

      <Show when={contextMenu()}>
        {(position) => (
          <Show when={contextTab()}>
            {(tab) => (
              <div
                class="fixed z-[10000] min-w-44 rounded-md border border-border-weaker-base bg-background-base shadow-lg py-1"
                style={{
                  left: `${position().x}px`,
                  top: `${position().y}px`,
                }}
                onClick={(event) => event.stopPropagation()}
              >
              <button
                class="block w-full text-left px-3 py-1.5 text-13-regular text-text-base hover:bg-background-stronger"
                onClick={() => runContextAction(() => props.onActivate(tab().id))}
              >
                Activate
              </button>
              <Show when={tab().type !== "review"}>
                <button
                  class="block w-full text-left px-3 py-1.5 text-13-regular text-text-base hover:bg-background-stronger"
                  onClick={() => runContextAction(() => props.onDuplicate(tab().id))}
                >
                  Duplicate
                </button>
              </Show>
              <button
                class="block w-full text-left px-3 py-1.5 text-13-regular text-text-base hover:bg-background-stronger"
                onClick={() => runContextAction(() => (tab().isPinned ? props.onUnpin(tab().id) : props.onPin(tab().id)))}
              >
                {tab().isPinned ? "Unpin" : "Pin"}
              </button>
              <div class="my-1 border-t border-border-weaker-base" />
              <Show when={!tab().isPinned}>
                <button
                  class="block w-full text-left px-3 py-1.5 text-13-regular text-text-base hover:bg-background-stronger"
                  onClick={() => runContextAction(() => props.onClose(tab().id))}
                >
                  Close
                </button>
              </Show>
              <button
                class="block w-full text-left px-3 py-1.5 text-13-regular text-text-base hover:bg-background-stronger"
                onClick={() => runContextAction(() => props.onCloseOthers(tab().id))}
              >
                Close Others
              </button>
              <button
                class="block w-full text-left px-3 py-1.5 text-13-regular text-text-base hover:bg-background-stronger"
                onClick={() => runContextAction(props.onCloseAll)}
              >
                Close All
              </button>
              <button
                class="block w-full text-left px-3 py-1.5 text-13-regular"
                classList={{
                  "text-text-base hover:bg-background-stronger": props.canReopenClosed,
                  "text-text-disabled cursor-default": !props.canReopenClosed,
                }}
                disabled={!props.canReopenClosed}
                onClick={() => runContextAction(props.onReopenClosed)}
              >
                Reopen Closed Tab
              </button>
              </div>
            )}
          </Show>
        )}
      </Show>
    </div>
  )
}
