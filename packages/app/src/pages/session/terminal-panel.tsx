import { For, Show, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Tabs } from "@opencode-ai/ui/tabs"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"

import { SortableTerminalTab, SortableTerminalTabV2 } from "@/components/session"
import { Terminal } from "@/components/terminal"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useTerminal } from "@/context/terminal"
import { terminalTabLabel } from "@/pages/session/terminal-label"
import { createSizing, focusTerminalById } from "@/pages/session/helpers"
import { getTerminalHandoff, setTerminalHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useTerminalPanelTabsV2 } from "@/pages/session/use-terminal-panel-tabs-v2"

export function TerminalPanel(props: { maxHeight?: () => number; variant?: "default" | "v2" } = {}) {
  const delays = [120, 240]
  const layout = useLayout()
  const terminal = useTerminal()
  const language = useLanguage()
  const command = useCommand()
  const { params, workspaceKey, view } = useSessionLayout()
  const tabsV2 = useTerminalPanelTabsV2({ terminal, enabled: () => props.variant === "v2" })

  const opened = createMemo(() => view().terminal.opened())
  const isV2 = () => props.variant === "v2"
  const size = createSizing()
  const height = createMemo(() => layout.terminal.height())
  const close = () => view().terminal.close()
  let root: HTMLDivElement | undefined

  const [store, setStore] = createStore({
    autoCreated: false,
    activeDraggable: undefined as string | undefined,
    recovered: {} as Record<string, boolean>,
    view: typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight),
  })

  const max = () => {
    const viewportMax = store.view * 0.6
    if (!props.maxHeight) return viewportMax
    return Math.min(viewportMax, props.maxHeight())
  }
  const pane = () => Math.min(height(), max())

  onMount(() => {
    if (typeof window === "undefined") return

    const sync = () => setStore("view", window.visualViewport?.height ?? window.innerHeight)
    const port = window.visualViewport

    sync()
    makeEventListener(window, "resize", sync)
    if (port) makeEventListener(port, "resize", sync)
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
        if (prevCount === undefined || prevCount <= 0 || count !== 0) return
        if (!opened()) return
        close()
      },
    ),
  )

  const focus = (id: string) => {
    focusTerminalById(id)

    const frame = requestAnimationFrame(() => {
      if (!opened()) return
      if (terminal.active() !== id) return
      focusTerminalById(id)
    })

    const timers = delays.map((ms) =>
      window.setTimeout(() => {
        if (!opened()) return
        if (terminal.active() !== id) return
        focusTerminalById(id)
      }, ms),
    )

    return () => {
      cancelAnimationFrame(frame)
      for (const timer of timers) clearTimeout(timer)
    }
  }

  createEffect(
    on(
      () => [opened(), terminal.active()] as const,
      ([next, id]) => {
        if (!next || !id) return
        const stop = focus(id)
        onCleanup(stop)
      },
    ),
  )

  createEffect(() => {
    if (opened()) return
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (!root?.contains(active)) return
    active.blur()
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (!terminal.ready()) return
    language.locale()

    setTerminalHandoff(
      workspaceKey(),
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
    return getTerminalHandoff(workspaceKey()) ?? []
  })

  const all = terminal.all
  const ids = createMemo(() => all().map((pty) => pty.id))

  const recoverTerminal = (key: string, id: string, clone: (id: string) => Promise<void>) => {
    if (store.recovered[key]) return
    setStore("recovered", key, true)
    void clone(id)
  }

  const terminalRecoveryKey = (pty: { id: string; title: string; titleNumber: number }) => {
    return String(pty.titleNumber || pty.title || pty.id)
  }

  const markTerminalConnected = (key: string, id: string, trim: (id: string) => void) => {
    setStore("recovered", key, false)
    trim(id)
  }

  const handleTerminalDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleTerminalDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const terminals = terminal.all()
    const fromIndex = terminals.findIndex((t) => t.id === draggable.id.toString())
    const toIndex = terminals.findIndex((t) => t.id === droppable.id.toString())
    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      terminal.move(draggable.id.toString(), toIndex)
    }
  }

  const handleTerminalDragEnd = () => {
    setStore("activeDraggable", undefined)

    const activeId = terminal.active()
    if (!activeId) return
    requestAnimationFrame(() => {
      if (terminal.active() !== activeId) return
      focusTerminalById(activeId)
    })
  }

  const terminalById = (id: string) => all().find((pty) => pty.id === id)

  const terminalContent = () => (
    <div class="flex-1 min-h-0 relative">
      <Show when={terminal.active()} keyed>
        {(id) => {
          const ops = terminal.bind()
          return (
            <Show when={terminalById(id)}>
              {(pty) => (
                <div id={`terminal-wrapper-${id}`} class="absolute inset-0">
                  <Terminal
                    pty={pty()}
                    autoFocus={opened()}
                    onConnect={() => markTerminalConnected(terminalRecoveryKey(pty()), id, ops.trim)}
                    onCleanup={ops.update}
                    onConnectError={() => recoverTerminal(terminalRecoveryKey(pty()), id, ops.clone)}
                  />
                </div>
              )}
            </Show>
          )
        }}
      </Show>
    </div>
  )

  const loadingTabsBar = () => (
    <Show
      when={isV2()}
      fallback={
        <div class="h-10 flex items-center gap-2 px-2 border-b border-border-weaker-base bg-background-stronger overflow-hidden">
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
      }
    >
      <div class="session-review-v2-tabs-bar">
        <div class="session-review-v2-tabs-list flex flex-1 min-w-0 items-center gap-2 overflow-hidden">
          <For each={handoff()}>
            {(title) => (
              <div class="px-2 py-1 rounded-md bg-surface-base text-13-regular text-text-weak truncate max-w-40">
                {title}
              </div>
            )}
          </For>
          <div class="flex-1" />
          <div class="text-text-weak pr-2 text-13-regular">
            {language.t("common.loading")}
            {language.t("common.loading.ellipsis")}
          </div>
        </div>
      </div>
    </Show>
  )

  const v1Tabs = () => (
    <>
      <Tabs
        variant="alt"
        value={terminal.active()}
        onChange={(id) => terminal.open(id)}
        class="!h-auto !flex-none"
      >
        <Tabs.List class="h-10 border-b border-border-weaker-base">
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
      {terminalContent()}
    </>
  )

  const v2Tabs = () => (
    <>
      <TabsV2
        variant="pill"
        value={terminal.active()}
        onChange={(id) => terminal.open(id)}
        class="session-review-v2-tabs flex flex-col h-full min-h-0"
      >
        <div class="session-review-v2-tabs-bar">
          <TabsV2.List class="session-review-v2-tabs-list" ref={tabsV2.setTabListRef}>
            <For each={tabsV2.visibleStripTabs()}>
              {(id) => (
                <Show when={terminalById(id)}>
                  {(pty) => (
                    <SortableTerminalTabV2
                      terminal={pty()}
                      onClose={close}
                      dragged={tabsV2.drag.active && tabsV2.drag.draggedTab === id}
                      pressed={tabsV2.pressedTab() === id}
                      dragActive={tabsV2.drag.active}
                      onStripPointerDown={(event) => tabsV2.onStripPointerDown(id, event)}
                    />
                  )}
                </Show>
              )}
            </For>
            <div class="session-review-v2-tabs-actions shrink-0 sticky right-0 z-10 flex items-center justify-center">
              <TooltipV2 placement="bottom" value={language.t("command.terminal.new")} class="flex items-center">
                <IconButtonV2
                  variant="ghost-muted"
                  size="large"
                  icon={<IconV2 name="plus" size="small" />}
                  onClick={terminal.new}
                  aria-label={language.t("command.terminal.new")}
                />
              </TooltipV2>
            </div>
          </TabsV2.List>
        </div>
        <div class="session-review-v2-panel-body">{terminalContent()}</div>
      </TabsV2>
      <Show when={tabsV2.drag.active && tabsV2.drag.draggedTab} keyed>
        {(id) => (
          <Show when={terminalById(id)}>
            {(pty) => (
              <Portal>
                <div style={tabsV2.floaterStyle()}>
                  <div data-component="tabs-v2-drag-preview">
                    <div class="truncate">
                      {terminalTabLabel({
                        title: pty().title,
                        titleNumber: pty().titleNumber,
                        t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
                      })}
                    </div>
                  </div>
                </div>
              </Portal>
            )}
          </Show>
        )}
      </Show>
    </>
  )

  return (
    <div
      ref={root}
      id="terminal-panel"
      role="region"
      aria-label={language.t("terminal.title")}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative w-full shrink-0 overflow-hidden bg-background-stronger"
      classList={{
        "border-t border-border-weak-base": opened() && !isV2(),
        "transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height] motion-reduce:transition-none":
          !size.active(),
      }}
      style={{ height: opened() ? `${pane()}px` : "0px" }}
    >
      <div
        class="absolute inset-x-0 top-0 flex flex-col"
        classList={{
          "pointer-events-none": !opened(),
        }}
        style={{ height: `${pane()}px` }}
      >
        <div class="hidden md:block" onPointerDown={() => size.start()}>
          <ResizeHandle
            direction="vertical"
            size={pane()}
            min={100}
            max={max()}
            collapseThreshold={50}
            onResize={(next) => {
              size.touch()
              layout.terminal.resize(next)
            }}
            onCollapse={close}
          />
        </div>
        <Show
          when={terminal.ready()}
          fallback={
            <div class="flex flex-col h-full pointer-events-none">
              {loadingTabsBar()}
              <div class="flex-1 flex items-center justify-center text-text-weak">{language.t("terminal.loading")}</div>
            </div>
          }
        >
          <Show when={isV2()} fallback={
            <DragDropProvider
              onDragStart={handleTerminalDragStart}
              onDragEnd={handleTerminalDragEnd}
              onDragOver={handleTerminalDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragYAxis />
              <div class="flex flex-col h-full min-h-0">{v1Tabs()}</div>
              <DragOverlay>
                <Show when={store.activeDraggable} keyed>
                  {(id) => (
                    <Show when={terminalById(id)}>
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
          }>
            <div class="flex flex-col h-full min-h-0">{v2Tabs()}</div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
