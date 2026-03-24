import { For, Show, batch, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
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
import { createSizing, focusTerminalById } from "@/pages/session/helpers"
import { getTerminalHandoff, setTerminalHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { terminalProbe } from "@/testing/terminal"

export function TerminalPanel() {
  const delays = [120, 240]
  const layout = useLayout()
  const terminal = useTerminal()
  const language = useLanguage()
  const command = useCommand()
  const { params, view } = useSessionLayout()

  const opened = createMemo(() => view().terminal.opened())
  const size = createSizing()
  const height = createMemo(() => layout.terminal.height())
  const width = createMemo(() => layout.terminal.width())
  const dock = createMemo(() => layout.terminal.dock())
  const right = createMemo(() => dock() === "right")
  const dockKeybind = createMemo(() => command.keybind("terminal.dock.toggle"))
  const close = () => view().terminal.close()
  let root: HTMLDivElement | undefined

  const [store, setStore] = createStore({
    autoCreated: false,
    activeDraggable: undefined as string | undefined,
    h: typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight),
    w: typeof window === "undefined" ? 1000 : window.innerWidth,
  })

  const side = createMemo(() => right() && store.w >= 768)
  const max = () => (side() ? store.w : store.h) * 0.6
  const pane = () => Math.min(side() ? width() : height(), max())

  onMount(() => {
    if (typeof window === "undefined") return

    const sync = () =>
      batch(() => {
        setStore("h", window.visualViewport?.height ?? window.innerHeight)
        setStore("w", window.innerWidth)
      })
    const port = window.visualViewport

    sync()
    window.addEventListener("resize", sync)
    port?.addEventListener("resize", sync)
    onCleanup(() => {
      window.removeEventListener("resize", sync)
      port?.removeEventListener("resize", sync)
    })
  })

  createEffect(
    on(
      () => [opened(), side()] as const,
      ([open]) => {
        if (!open) return
        if (typeof window === "undefined") return

        const timers = [0, 90, 180, 320].map((ms) =>
          window.setTimeout(() => window.dispatchEvent(new Event("resize")), ms),
        )
        onCleanup(() => timers.forEach((timer) => window.clearTimeout(timer)))
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
        if (prevCount === undefined || prevCount <= 0 || count !== 0) return
        if (!opened()) return
        close()
      },
    ),
  )

  const focus = (id: string) => {
    const probe = terminalProbe(id)
    probe.focus(delays.length + 1)
    focusTerminalById(id)

    const frame = requestAnimationFrame(() => {
      probe.step()
      if (!opened()) return
      if (terminal.active() !== id) return
      focusTerminalById(id)
    })

    const timers = delays.map((ms) =>
      window.setTimeout(() => {
        probe.step()
        if (!opened()) return
        if (terminal.active() !== id) return
        focusTerminalById(id)
      }, ms),
    )

    return () => {
      probe.focus(0)
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

  const all = terminal.all
  const ids = createMemo(() => all().map((pty) => pty.id))

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

  return (
    <div
      ref={root}
      id="terminal-panel"
      role="region"
      aria-label={language.t("terminal.title")}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative shrink-0 overflow-hidden bg-background-stronger"
      classList={{
        "w-full": !side(),
        "h-full": side(),
        "border-t border-border-weak-base": opened() && !side(),
        "border-l border-border-weak-base": opened() && side(),
        "transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height] motion-reduce:transition-none":
          !size.active() && !side(),
        "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
          !size.active() && side(),
      }}
      style={
        side()
          ? {
              width: opened() ? `${pane()}px` : "0px",
            }
          : {
              height: opened() ? `${pane()}px` : "0px",
            }
      }
    >
      <div
        class="absolute inset-0 flex flex-col"
        classList={{
          "pointer-events-none": !opened(),
        }}
      >
        <Show when={!side()}>
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
        </Show>
        <Show when={side()}>
          <div class="hidden md:block" onPointerDown={() => size.start()}>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={pane()}
              min={280}
              max={max()}
              collapseThreshold={140}
              onResize={(next) => {
                size.touch()
                layout.terminal.resizeWidth(next)
              }}
              onCollapse={close}
            />
          </div>
        </Show>
        <Show
          when={terminal.ready()}
          fallback={
            <div class="flex flex-col h-full pointer-events-none">
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
                  <div class="h-full pr-2 flex items-center justify-center">
                    <Show
                      when={dockKeybind()}
                      fallback={
                        <Tooltip
                          value={right() ? "Dock terminal to bottom" : "Dock terminal to right"}
                          class="flex items-center"
                        >
                          <IconButton
                            icon={right() ? "layout-bottom" : "layout-right"}
                            variant="ghost"
                            iconSize="large"
                            onClick={() => layout.terminal.toggleDock()}
                            aria-label={right() ? "Dock terminal to bottom" : "Dock terminal to right"}
                          />
                        </Tooltip>
                      }
                    >
                      {(keybind) => (
                        <TooltipKeybind
                          title={right() ? "Dock terminal to bottom" : "Dock terminal to right"}
                          keybind={keybind()}
                          class="flex items-center"
                        >
                          <IconButton
                            icon={right() ? "layout-bottom" : "layout-right"}
                            variant="ghost"
                            iconSize="large"
                            onClick={() => layout.terminal.toggleDock()}
                            aria-label={right() ? "Dock terminal to bottom" : "Dock terminal to right"}
                          />
                        </TooltipKeybind>
                      )}
                    </Show>
                  </div>
                </Tabs.List>
              </Tabs>
              <div class="flex-1 min-h-0 relative">
                <Show when={terminal.active()} keyed>
                  {(id) => {
                    const ops = terminal.bind()
                    return (
                      <Show when={all().find((pty) => pty.id === id)}>
                        {(pty) => (
                          <div id={`terminal-wrapper-${id}`} class="absolute inset-0">
                            <Terminal
                              pty={pty()}
                              autoFocus={opened()}
                              onConnect={() => ops.trim(id)}
                              onCleanup={ops.update}
                              onConnectError={() => ops.clone(id)}
                            />
                          </div>
                        )}
                      </Show>
                    )
                  }}
                </Show>
              </div>
            </div>
            <DragOverlay>
              <Show when={store.activeDraggable} keyed>
                {(id) => (
                  <Show when={all().find((pty) => pty.id === id)}>
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
    </div>
  )
}
