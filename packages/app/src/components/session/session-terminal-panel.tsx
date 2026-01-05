import { For, Show, createMemo, type JSX } from "solid-js"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useLayout } from "@/context/layout"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useCommand } from "@/context/command"
import { Terminal } from "@/components/terminal"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { SortableTerminalTab } from "./session-sortable-terminal-tab"
import { createStore } from "solid-js/store"

export interface TerminalPanelProps {
  position: "bottom" | "right"
  fullHeight?: boolean
}

export function TerminalPanel(props: TerminalPanelProps): JSX.Element {
  const layout = useLayout()
  const terminal = useTerminal()
  const command = useCommand()

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const terminals = terminal.all()
      const fromIndex = terminals.findIndex((t: LocalPTY) => t.id === draggable.id.toString())
      const toIndex = terminals.findIndex((t: LocalPTY) => t.id === droppable.id.toString())
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        terminal.move(draggable.id.toString(), toIndex)
      }
    }
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  return (
    <div
      classList={{
        "relative w-full flex-col border-t border-border-weak-base": true,
        "shrink-0": !props.fullHeight,
        "flex-1": props.fullHeight,
      }}
      style={props.fullHeight ? undefined : { height: `${layout.terminal.height()}px` }}
    >
      <ResizeHandle
        class={props.fullHeight ? "hidden" : ""}
        direction="vertical"
        size={layout.terminal.height()}
        min={100}
        max={window.innerHeight * 0.6}
        collapseThreshold={50}
        onResize={layout.terminal.resize}
        onCollapse={layout.terminal.close}
      />
      <DragDropProvider
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        collisionDetector={closestCenter}
      >
        <DragDropSensors />
        <ConstrainDragYAxis />
        <Tabs variant="alt" value={terminal.active()} onChange={terminal.open}>
          <Tabs.List class="h-10">
            <div class="h-full flex items-center justify-center px-2">
              <TooltipKeybind
                title={props.position === "bottom" ? "Move terminal to right" : "Move terminal to bottom"}
                keybind={command.keybind("terminal.position.toggle")}
                class="flex items-center"
              >
                <IconButton
                  icon={props.position === "bottom" ? "layout-right" : "layout-bottom"}
                  variant="ghost"
                  iconSize="large"
                  onClick={layout.terminal.togglePosition}
                />
              </TooltipKeybind>
            </div>
            <SortableProvider ids={terminal.all().map((t: LocalPTY) => t.id)}>
              <For each={terminal.all()}>{(pty) => <SortableTerminalTab terminal={pty} />}</For>
            </SortableProvider>
            <div class="h-full flex items-center justify-center">
              <TooltipKeybind title="New terminal" keybind={command.keybind("terminal.new")} class="flex items-center">
                <IconButton icon="plus-small" variant="ghost" iconSize="large" onClick={terminal.new} />
              </TooltipKeybind>
            </div>
          </Tabs.List>
          <For each={terminal.all()}>
            {(pty) => (
              <Tabs.Content value={pty.id}>
                <Terminal pty={pty} onCleanup={terminal.update} onConnectError={() => terminal.clone(pty.id)} />
              </Tabs.Content>
            )}
          </For>
        </Tabs>
        <DragOverlay>
          <Show when={store.activeDraggable}>
            {(draggedId) => {
              const pty = createMemo(() => terminal.all().find((t: LocalPTY) => t.id === draggedId()))
              return (
                <Show when={pty()}>
                  {(t) => (
                    <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                      {t().title}
                    </div>
                  )}
                </Show>
              )
            }}
          </Show>
        </DragOverlay>
      </DragDropProvider>
    </div>
  )
}
