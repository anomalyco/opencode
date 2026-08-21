import { For, Show, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Keybind } from "@opencode-ai/ui/keybind"

import { SortableTerminalTab } from "@/session/terminal/tab"
import { Terminal } from "@/components/terminal"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useTerminal } from "@/context/terminal"
import { useWorkspaceLocation } from "@/context/location"
import { terminalTabLabel } from "@/session/terminal/terminal-label"
import { createSizing, focusTerminalById } from "@/session/helpers"
import { getTerminalHandoff, setTerminalHandoff } from "@/session/handoff"
import { useSessionLayout } from "@/session/session-layout"
import { TerminalSurface } from "./surface"

export function TerminalPanel(props: { stacked?: boolean } = {}) {
  const layout = useLayout()
  const terminal = useTerminal()
  const sdk = useWorkspaceLocation()
  const language = useLanguage()
  const command = useCommand()
  const { workspaceKey, view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const opened = createMemo(() => view().terminal.opened())
  const size = createSizing()
  const height = createMemo(() => layout.terminal.height())
  const close = () => view().terminal.close()
  let root: HTMLElement | undefined
  let tabList: HTMLDivElement | undefined

  onCleanup(() => terminal.cancelFocus())

  const [store, setStore] = createStore({
    autoCreated: false,
    recovered: {} as Record<string, boolean>,
    view: typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight),
  })

  const max = () => store.view * 0.6
  const pane = () => Math.min(height(), max())
  const stacked = createMemo(() => isDesktop() && !!props.stacked)
  const panelHeight = createMemo(() =>
    isDesktop() ? (stacked() ? `${pane()}px` : "100%") : opened() ? `${pane()}px` : "0px",
  )
  const contentHeight = createMemo(() => (isDesktop() ? (stacked() ? `${pane()}px` : "100%") : `${pane()}px`))
  const newTerminalKeybind = createMemo(() => command.keybindParts("terminal.new"))

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

  createEffect(
    on(
      () => [opened(), terminal.active(), terminal.focusRequested(terminal.active())] as const,
      ([next, id, requested]) => {
        if (!next || !id || !requested) return
        focusTerminalById(id)
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
    const dir = sdk().directory
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
    const dir = sdk().directory
    if (!dir) return []
    return getTerminalHandoff(workspaceKey()) ?? []
  })

  const all = terminal.all

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

  const handleTerminalDragEnd = () => {
    const activeId = terminal.active()
    if (!activeId) return
    requestAnimationFrame(() => {
      if (terminal.active() !== activeId) return
      focusTerminalById(activeId)
    })
  }

  return (
    <TerminalSurface
      ref={(element) => {
        root = element
      }}
      label={language.t("terminal.title")}
      opened={opened()}
      desktop={isDesktop()}
      stacked={stacked()}
      height={panelHeight()}
      contentHeight={contentHeight()}
      pane={pane()}
      max={max()}
      resizing={size.active()}
      onResizeStart={size.start}
      onResize={(next) => {
        size.touch()
        layout.terminal.resize(next)
      }}
      onCollapse={close}
    >
      <Show
        when={terminal.ready()}
        fallback={
          <div class="flex flex-col h-full pointer-events-none">
            <div class="h-10 flex items-center gap-2 px-2 border-b border-border-weaker-base bg-v2-background-bg-base overflow-hidden">
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
          sensors={[
            PointerSensor.configure({
              activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
              preventActivation: (event) =>
                event.target instanceof Element &&
                !!event.target.closest('[data-slot="tabs-trigger-close-button"], input, [contenteditable="true"]'),
            }),
          ]}
          modifiers={[RestrictToHorizontalAxis, RestrictToElement.configure({ element: () => tabList ?? null })]}
          plugins={(defaults) => [
            ...defaults.filter((plugin) => plugin !== Accessibility),
            AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
            Feedback.configure({ dropAnimation: null }),
          ]}
          onDragEnd={(event) => {
            const source = event.operation.source
            if (!event.canceled && isSortable(source) && source.initialIndex !== source.index) {
              terminal.move(source.id.toString(), source.index)
            }
            handleTerminalDragEnd()
          }}
        >
          <div class="flex flex-col h-full">
            <Tabs
              variant="panel"
              value={terminal.active()}
              onChange={(id) => terminal.open(id)}
              class="!h-[52px] !flex-none"
            >
              <Tabs.List
                ref={tabList}
                onPointerDown={(event: PointerEvent & { currentTarget: HTMLDivElement }) => {
                  const active = document.activeElement
                  if (event.target === active) return
                  if (active instanceof HTMLInputElement && event.currentTarget.contains(active)) active.blur()
                }}
              >
                <For each={all()}>
                  {(pty, index) => <SortableTerminalTab terminal={pty} index={index()} onClose={close} />}
                </For>
                <div class="h-full flex items-center justify-center">
                  <Tooltip
                    value={
                      <>
                        {language.t("command.terminal.new")}
                        <Show when={newTerminalKeybind().length > 0}>
                          <Keybind keys={newTerminalKeybind()} variant="neutral" />
                        </Show>
                      </>
                    }
                    placement="bottom"
                    class="flex items-center"
                  >
                    <IconButton
                      icon={<Icon name="plus-small" size="large" />}
                      variant="ghost"
                      onClick={() => terminal.new({ focus: true })}
                      aria-label={language.t("command.terminal.new")}
                    />
                  </Tooltip>
                </div>
              </Tabs.List>
            </Tabs>
            <div class="flex-1 min-h-0 relative">
              <Show when={opened() && terminal.active()} keyed>
                {(id) => {
                  const ops = terminal.bind()
                  return (
                    <Show when={all().find((pty) => pty.id === id)}>
                      {(pty) => (
                        <div id={`terminal-wrapper-${id}`} class="absolute inset-0">
                          <Terminal
                            pty={pty()}
                            autoFocus={terminal.focusRequested(id)}
                            onAutoFocus={() => terminal.consumeFocus(id)}
                            class="!px-[14px]"
                            onConnect={() =>
                              markTerminalConnected(terminalRecoveryKey(pty()), id, (terminalID) =>
                                ops.trim(terminalID),
                              )
                            }
                            onCleanup={(terminal) => ops.update(terminal)}
                            onConnectError={() =>
                              recoverTerminal(terminalRecoveryKey(pty()), id, (terminalID) => ops.clone(terminalID))
                            }
                          />
                        </div>
                      )}
                    </Show>
                  )
                }}
              </Show>
            </div>
          </div>
        </DragDropProvider>
      </Show>
    </TerminalSurface>
  )
}
