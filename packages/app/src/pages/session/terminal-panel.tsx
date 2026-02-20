import { For, Show, createEffect, createMemo, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useParams } from "@solidjs/router"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"

import { SortableTerminalTab } from "@/components/session"
import { Terminal } from "@/components/terminal"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { terminalTabLabel } from "@/pages/session/terminal-label"
import { focusTerminalById } from "@/pages/session/helpers"
import { getTerminalHandoff, setTerminalHandoff } from "@/pages/session/handoff"

export function TerminalPanel() {
  const params = useParams()
  const layout = useLayout()
  const terminal = useTerminal()
  const language = useLanguage()
  const command = useCommand()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey))

  const opened = createMemo(() => view().terminal.opened())
  const open = createMemo(() => isDesktop() && opened())
  const height = createMemo(() => layout.terminal.height())
  const close = () => view().terminal.close()

  const [store, setStore] = createStore({
    autoCreated: false,
    activeDraggable: undefined as string | undefined,
  })

  createEffect(() => {
    if (!opened()) {
      setStore("autoCreated", false)
      return
    }

    if (!terminal.ready() || terminal.all().length !== 0 || store.autoCreated) return
    terminal.new()
    setStore("autoCreated", true)
  })

  createEffect(
    on(
      () => terminal.all().length,
      (count, prevCount) => {
        if (prevCount !== undefined && prevCount > 0 && count === 0) {
          if (opened()) view().terminal.toggle()
        }
      },
    ),
  )

  createEffect(
    on(
      () => terminal.active(),
      (activeId) => {
        if (!activeId || !open()) return
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        setTimeout(() => focusTerminalById(activeId), 0)
      },
    ),
  )

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (!terminal.ready()) return
    language.locale()

    setTerminalHandoff(
      dir,
      terminal.all().map((pty) =>
        terminalTabLabel({
          title: pty.title,
          titleNumber: pty.titleNumber,
          t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
        }),
      ),
    )
  })

  const handoff = createMemo(() => {
    const dir = params.dir
    if (!dir) return []
    return getTerminalHandoff(dir) ?? []
  })

  const all = createMemo(() => terminal.all())
  const ids = createMemo(() => all().map((pty) => pty.id))
  const byId = createMemo(() => new Map(all().map((pty) => [pty.id, pty])))

  const handleTerminalDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleTerminalDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const terminals = terminal.all()
    const fromIndex = terminals.findIndex((t: LocalPTY) => t.id === draggable.id.toString())
    const toIndex = terminals.findIndex((t: LocalPTY) => t.id === droppable.id.toString())
    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      terminal.move(draggable.id.toString(), toIndex)
    }
  }

  const handleTerminalDragEnd = () => {
    setStore("activeDraggable", undefined)

    const activeId = terminal.active()
    if (!activeId) return
    setTimeout(() => {
      focusTerminalById(activeId)
    }, 0)
  }

  return (
    <Show when={open()}>
      <div
        id="terminal-panel"
        role="region"
        aria-label={language.t("terminal.title")}
        class="relative w-full flex flex-col shrink-0 border-t border-border-weak-base"
        style={{ height: `${height()}px` }}
      >
        <ResizeHandle
          direction="vertical"
          size={height()}
          min={100}
          max={typeof window === "undefined" ? 1000 : window.innerHeight * 0.6}
          collapseThreshold={50}
          onResize={layout.terminal.resize}
          onCollapse={close}
        />
        <Show
          when={terminal.ready()}
          fallback={
            <div class="flex flex-col h-full pointer-events-none">
              <div class="h-10 flex items-center gap-2 px-2 border-b border-border-weak-base bg-background-stronger overflow-hidden">
                <For each={handoff()}>
                  {(title) => (
                    <div class="px-2 py-1 rounded-md bg-surface-base text-14-regular text-text-weak truncate max-w-40">
                      {title}
                    </div>
                  )}
                </For>
                <div class="flex-1" />
                <div class="text-text-weak pr-2">
                  {language.t("common.loading")}
                  {language.t("common.loading.ellipsis")}
                </div>
              </div>
              <div class="flex-1 flex items-center justify-center text-text-weak">{language.t("terminal.loading")}</div>
            </div>
          }
        >
          <DragDropProvider
            onDragStart={handleTerminalDragStart}
            onDragEnd={handleTerminalDragEnd}
            onDragOver={handleTerminalDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragYAxis />
            <div class="flex flex-col h-full">
              <Tabs
                variant="alt"
                value={terminal.active()}
                onChange={(id) => terminal.open(id)}
                class="!h-auto !flex-none"
              >
                <Tabs.List class="h-10">
                  <SortableProvider ids={ids()}>
                    <For each={all()}>{(pty) => <SortableTerminalTab terminal={pty} onClose={close} />}</For>
                  </SortableProvider>
                  <div class="h-full flex items-center justify-center">
                    <TooltipKeybind
                      title={language.t("command.terminal.new")}
                      keybind={command.keybind("terminal.new")}
                      class="flex items-center"
                    >
                      <IconButton
                        icon="plus-small"
                        variant="ghost"
                        iconSize="large"
                        onClick={terminal.new}
                        aria-label={language.t("command.terminal.new")}
                      />
                    </TooltipKeybind>
                  </div>
                </Tabs.List>
              </Tabs>
              <div class="flex-1 min-h-0 relative">
                <Show when={terminal.active()} keyed>
                  {(id) => (
                    <Show when={byId().get(id)}>
                      {(pty) => (
                        <div id={`terminal-wrapper-${id}`} class="absolute inset-0">
                          <Terminal pty={pty()} onCleanup={terminal.update} onConnectError={() => terminal.clone(id)} />
                        </div>
                      )}
                    </Show>
                  )}
                </Show>
              </div>
            </div>
            <DragOverlay>
              <Show when={store.activeDraggable}>
                {(draggedId) => (
                  <Show when={byId().get(draggedId())}>
                    {(t) => (
                      <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                        {terminalTabLabel({
                          title: t().title,
                          titleNumber: t().titleNumber,
                          t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
                        })}
                      </div>
                    )}
                  </Show>
                )}
              </Show>
            </DragOverlay>
          </DragDropProvider>
        </Show>
      </div>
    </Show>
  )
}
