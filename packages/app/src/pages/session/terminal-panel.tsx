import { For, Show, createEffect, createMemo, on, onCleanup } from "solid-js"
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
import { useTerminal } from "@/context/terminal"
import { terminalTabLabel } from "@/pages/session/terminal-label"
import { focusTerminalById } from "@/pages/session/helpers"
import { getTerminalHandoff, setTerminalHandoff } from "@/pages/session/handoff"
import {
  splitAdd,
  splitEqual,
  splitHead,
  splitMembers,
  splitNormalize,
  splitRemove,
  splitSibling,
  type SplitGroups,
} from "@/pages/session/terminal-split"

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
    splitGroups: {} as SplitGroups,
  })
  const timers = new Set<number>()
  const defer = (fn: VoidFunction) => {
    if (typeof window === "undefined") {
      fn()
      return
    }

    const id = window.setTimeout(() => {
      timers.delete(id)
      fn()
    }, 0)
    timers.add(id)
  }

  onCleanup(() => {
    for (const id of timers) {
      clearTimeout(id)
    }
    timers.clear()
  })

  createEffect(
    on(
      () => ({
        ids: terminal.all().map((pty) => pty.id),
        active: terminal.active(),
      }),
      (next, prev) => {
        const groups = store.splitGroups
        const normalized = splitNormalize(groups, next.ids)
        if (!splitEqual(groups, normalized)) {
          setStore("splitGroups", normalized)
        }

        const removedActive = prev?.active && !next.ids.includes(prev.active) ? prev.active : undefined
        if (!removedActive) return

        const sibling = splitSibling(groups, removedActive, next.ids)
        if (!sibling) return
        if (next.active === sibling) return

        defer(() => {
          if (!terminal.all().some((pty) => pty.id === sibling)) return
          if (terminal.active() === sibling) return
          terminal.open(sibling)
        })
      },
    ),
  )

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
        defer(() => focusTerminalById(activeId))
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
  const tabIds = createMemo(() => {
    const used = new Set<string>()
    return all().flatMap((pty) => {
      const id = pty.id
      if (used.has(id)) return []

      const group = splitMembers(store.splitGroups, id)
      if (!group) {
        used.add(id)
        return [id]
      }

      if (group[0] !== id) return []
      group.forEach((item) => used.add(item))
      return [id]
    })
  })
  const tabs = createMemo(() =>
    tabIds().flatMap((id) => {
      const pty = byId().get(id)
      if (!pty) return []
      return [pty]
    }),
  )
  const activeTab = createMemo(() => {
    const active = terminal.active()
    if (!active) return
    return splitHead(store.splitGroups, active) ?? active
  })

  const handleTerminalDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleTerminalDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const list = tabIds()
    const draggableId = draggable.id.toString()
    const droppableId = droppable.id.toString()
    const fromIndex = list.findIndex((id) => id === draggableId)
    const toIndex = list.findIndex((id) => id === droppableId)
    const allIds = ids()
    const moveTo = toIndex >= 0 ? allIds.findIndex((id) => id === list[toIndex]) : -1
    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      if (moveTo === -1) return
      terminal.move(draggableId, moveTo)
    }
  }

  const handleTerminalDragEnd = () => {
    setStore("activeDraggable", undefined)

    const activeId = terminal.active()
    if (!activeId) return
    defer(() => {
      focusTerminalById(activeId)
    })
  }

  const split = async (id: string) => {
    const target = (() => {
      const group = splitMembers(store.splitGroups, id)
      const active = terminal.active()
      if (!group || !active || !group.includes(active)) return id
      return active
    })()
    const source = byId().get(target)
    const created = await terminal.create({ title: source?.title })
    if (!created) return

    setStore("splitGroups", (groups) => splitAdd(groups, target, created))
  }

  const closeTerminal = async (id: string) => {
    const group = splitMembers(store.splitGroups, id)
    const remove = group ? [...group] : [id]

    setStore("splitGroups", (groups) => remove.reduce((next, item) => splitRemove(next, item), groups))
    await terminal.closeMany(remove)
  }

  const panes = createMemo(() => {
    const active = terminal.active()
    if (!active) return []
    const group = splitMembers(store.splitGroups, active)
    if (!group) return [active]
    return group
  })

  const paneCount = createMemo(() => panes().length)
  const visiblePanes = createMemo(() => panes().filter((id) => byId().has(id)))
  const paneItems = createMemo(() =>
    visiblePanes().flatMap((id) => {
      const pty = byId().get(id)
      if (!pty) return []
      return [{ id, pty }]
    }),
  )
  const dragItem = createMemo(() => {
    const id = store.activeDraggable
    if (!id) return
    const pty = byId().get(id)
    if (!pty) return
    return { id, pty }
  })

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
              <Tabs variant="alt" value={activeTab()} onChange={(id) => terminal.open(id)} class="!h-auto !flex-none">
                <Tabs.List class="h-10">
                  <SortableProvider ids={tabIds()}>
                    <For each={tabs()}>
                      {(pty) => <SortableTerminalTab terminal={pty} onClose={closeTerminal} onSplit={split} />}
                    </For>
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
                <div class="absolute inset-0 flex" classList={{ "divide-x divide-border-weak-base": paneCount() > 1 }}>
                  <For each={paneItems()}>
                    {(item) => (
                      <div
                        classList={{
                          "relative min-h-0 min-w-0": true,
                          "h-full w-full": paneCount() === 1,
                          "flex-1": paneCount() > 1,
                        }}
                        onPointerDown={() => {
                          if (terminal.active() === item.id) return
                          terminal.open(item.id)
                        }}
                      >
                        <div id={`terminal-wrapper-${item.id}`} class="absolute inset-0">
                          <Terminal
                            pty={item.pty}
                            onCleanup={terminal.update}
                            onConnectError={() => terminal.clone(item.id)}
                          />
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
            <DragOverlay>
              {(() => {
                const item = dragItem()
                if (!item) return null
                return (
                  <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                    {terminalTabLabel({
                      title: item.pty.title,
                      titleNumber: item.pty.titleNumber,
                      t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
                    })}
                  </div>
                )
              })()}
            </DragOverlay>
          </DragDropProvider>
        </Show>
      </div>
    </Show>
  )
}
