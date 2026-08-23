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
import { Terminal } from "@/session/terminal/terminal"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { useTerminal, type LocalPTY } from "@/session/terminal/context"
import { useWorkspaceLocation } from "@/workspaces/location"
import { terminalTabLabel } from "@/session/terminal/terminal-label"
import { createSizing, focusTerminalById } from "@/session/helpers"
import { getTerminalHandoff, setTerminalHandoff } from "@/session/handoff"
import { useSessionLayout } from "@/session/session-layout"
import { TerminalSurface } from "./surface"

const MAX_CACHED_TERMINAL_WORKSPACES = 20

type TerminalBinding = ReturnType<ReturnType<typeof useTerminal>["bind"]>
type CachedTerminalSurface = {
  key: string
  workspace: string
  pty: LocalPTY
  ops: TerminalBinding
  focus: boolean
}

export function TerminalPanel(
  props: { stacked?: boolean; fill?: boolean; framed?: boolean; present?: boolean; contentHeight?: string } = {},
) {
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
    autoCreated: undefined as string | undefined,
    recovered: {} as Record<string, boolean>,
    surfaces: [] as CachedTerminalSurface[],
    workspaces: [] as string[],
    view: typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight),
  })

  const max = () => store.view * 0.6
  const pane = () => Math.min(height(), max())
  const stacked = createMemo(() => isDesktop() && !!props.stacked)
  const panelHeight = createMemo(() => {
    if (props.fill) return "100%"
    if (!opened()) return "0px"
    if (isDesktop()) return stacked() ? `${pane()}px` : "100%"
    return `${pane()}px`
  })
  const contentHeight = createMemo(
    () => props.contentHeight ?? (isDesktop() ? (stacked() ? `${pane()}px` : "100%") : `${pane()}px`),
  )
  const present = createMemo(() => opened() || !!props.present)
  const newTerminalKeybind = createMemo(() => command.keybindParts("terminal.new"))

  onMount(() => {
    if (typeof window === "undefined") return

    const sync = () => setStore("view", window.visualViewport?.height ?? window.innerHeight)
    const port = window.visualViewport

    sync()
    makeEventListener(window, "resize", sync)
    if (port) makeEventListener(port, "resize", sync)
    makeEventListener(document, "focusin", (event) => {
      if (event.target instanceof Element && event.target.closest("#terminal-panel")) return
      setStore("surfaces", (surface) => surface.focus, "focus", false)
    })
  })

  createEffect(() => {
    if (!opened()) {
      setStore("autoCreated", undefined)
      return
    }

    const workspace = workspaceKey()
    if (!terminal.ready() || terminal.all().length !== 0 || store.autoCreated === workspace) return
    terminal.new()
    setStore("autoCreated", workspace)
  })

  createEffect(
    on(
      () => [workspaceKey(), terminal.all().length] as const,
      ([workspace, count], previous) => {
        if (!previous || previous[0] !== workspace || previous[1] <= 0 || count !== 0) return
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
        requestAnimationFrame(() => {
          if (!opened() || terminal.active() !== id || !terminal.focusRequested(id)) return
          focusTerminalById(id)
        })
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

  createEffect(
    on(
      () => [workspaceKey(), terminal.ready(), terminal.active(), terminal.all()] as const,
      ([workspace, ready, active, ptys]) => {
        if (!ready) return

        const ids = new Set(ptys.map((pty) => pty.id))
        const surfaces = store.surfaces.filter((surface) => surface.workspace !== workspace || ids.has(surface.pty.id))
        const pty = ptys.find((item) => item.id === active)
        const key = pty ? `${workspace}\0${pty.id}` : undefined
        if (pty && key && !surfaces.some((surface) => surface.key === key)) {
          surfaces.push({ key, workspace, pty, ops: terminal.bind(), focus: terminal.focusRequested(pty.id) })
        }

        const workspaces = [...store.workspaces.filter((item) => item !== workspace), workspace].slice(
          -MAX_CACHED_TERMINAL_WORKSPACES,
        )
        const keep = new Set(workspaces)
        setStore({ surfaces: surfaces.filter((surface) => keep.has(surface.workspace)), workspaces })
      },
    ),
  )

  const recoverTerminal = (key: string, id: string, clone: (id: string) => Promise<void>) => {
    if (store.recovered[key]) return
    setStore("recovered", key, true)
    void clone(id)
  }

  const markTerminalConnected = (key: string, id: string, trim: (id: string) => void) => {
    setStore("recovered", key, false)
    trim(id)
    const index = store.surfaces.findIndex((surface) => surface.key === key)
    if (!store.surfaces[index]?.focus) return
    setStore("surfaces", index, "focus", false)
    if (!opened() || terminal.active() !== id) return
    focusTerminalById(id)
    terminal.consumeFocus(id)
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
      present={present()}
      framed={props.framed}
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
        when={terminal.ready() || store.surfaces.length > 0}
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
              <For each={store.surfaces}>
                {(surface) => (
                  <div
                    id={`terminal-wrapper-${surface.pty.id}`}
                    class="absolute inset-0"
                    classList={{
                      hidden:
                        !present() || surface.workspace !== workspaceKey() || surface.pty.id !== terminal.active(),
                    }}
                  >
                    <Terminal
                      pty={surface.pty}
                      autoFocus={terminal.focusRequested(surface.pty.id)}
                      onAutoFocus={() => {
                        focusTerminalById(surface.pty.id)
                        terminal.consumeFocus(surface.pty.id)
                      }}
                      class="!px-[14px]"
                      onConnect={() =>
                        markTerminalConnected(surface.key, surface.pty.id, (terminalID) => surface.ops.trim(terminalID))
                      }
                      onCleanup={(terminal) => surface.ops.update(terminal)}
                      onConnectError={() =>
                        recoverTerminal(surface.key, surface.pty.id, (terminalID) => surface.ops.clone(terminalID))
                      }
                    />
                  </div>
                )}
              </For>
            </div>
          </div>
        </DragDropProvider>
      </Show>
    </TerminalSurface>
  )
}
