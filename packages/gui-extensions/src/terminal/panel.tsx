import { For, Show, createMemo, onCleanup, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { Tabs } from "@opencode/ui/tabs"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { Keybind } from "@opencode/ui/keybind"
import { createKeyed, useExtension, usePanel, type MountedSession } from "../sdk"
import type { TerminalModel, TerminalWorkspace } from "./model"
import type { LocalPTY } from "./state"
import { SortableTerminalTab } from "./tab"
import { Terminal } from "./terminal"
import { terminalTabLabel } from "./title"
import { focusTerminalById } from "./focus"

const MAX_CACHED_TERMINAL_WORKSPACES = 20

type CachedTerminalSurface = {
  key: string
  workspace: string
  pty: LocalPTY
  ops: TerminalWorkspace
  focus: boolean
}

type TerminalPanelState = {
  recovered: Record<string, boolean>
  surfaces: CachedTerminalSurface[]
  workspaces: string[]
}

export default function TerminalPanel(props: { model: TerminalModel; session: MountedSession; onClose: () => void }) {
  const extension = useExtension()
  const keybinds = extension.keybinds
  const frame = usePanel()
  const terminal = createMemo(() => props.model.load(props.session))
  const workspaceKey = () => terminal().key
  const opened = frame.visible
  const present = frame.present
  const close = () => props.onClose()
  let tabList: HTMLDivElement | undefined

  onCleanup(() => terminal().cancelFocus())

  const [store, setStore] = createStore<TerminalPanelState>({ recovered: {}, surfaces: [], workspaces: [] })

  const newTerminalKeybind = createMemo(() => [...keybinds.keybind("terminal.new")])

  onMount(() => {
    makeEventListener(document, "focusin", (event) => {
      if (event.target instanceof Element && event.target.closest("#terminal-panel")) return

      setStore("surfaces", (surface) => surface.focus, "focus", false)
    })
  })

  // While the dock shows, a workspace first observed empty gets its first terminal, once per workspace in a row.
  createKeyed(opened, () => {
    const seen = { workspace: "" }

    createKeyed(
      () => {
        const workspace = terminal()

        return workspace.ready() ? workspace : undefined
      },
      (workspace) => {
        if (seen.workspace === workspace.key) return

        seen.workspace = workspace.key

        if (workspace.all().length === 0) workspace.new()
      },
    )
  })

  // The dock closes when the shown workspace loses its last terminal, e.g. when its shell exits.
  createKeyed(
    () => (terminal().all().length > 0 ? terminal() : undefined),
    (workspace) =>
      onCleanup(() =>
        untrack(() => {
          if (terminal() === workspace && workspace.all().length === 0 && opened()) close()
        }),
      ),
  )

  // Focuses the active terminal once the dock shows it and a focus request names it.
  createKeyed(
    () => {
      const id = terminal().active()

      return opened() && id && terminal().focusRequested(id) ? { id } : undefined
    },
    (request) =>
      requestAnimationFrame(() => {
        if (!opened() || terminal().active() !== request.id || !terminal().focusRequested(request.id)) return

        focusTerminalById(request.id)
      }),
  )

  // The titles outlive this instance: after a reload they show until the stored terminals load.
  createKeyed(
    () => {
      if (!props.session.directory || !terminal().ready()) return

      return {
        workspace: workspaceKey(),
        titles: terminal()
          .all()
          .map((pty) => terminalTabLabel({ title: pty.title, titleNumber: pty.titleNumber, t: extension.t })),
      }
    },
    (handoff) => props.model.handoff.set(handoff.workspace, handoff.titles),
    {
      // A terminal changing anything but its title keeps the titles.
      equals: (previous, next) =>
        previous.workspace === next.workspace &&
        previous.titles.length === next.titles.length &&
        previous.titles.every((title, index) => title === next.titles[index]),
    },
  )

  const handoff = createMemo(() => {
    const dir = props.session.directory

    if (!dir) return []

    return props.model.handoff.get(workspaceKey()) ?? []
  })

  const all = () => terminal().all()

  // Keeps each shown terminal mounted for the workspaces shown last, so switching back keeps its screen and session.
  createKeyed(
    () => ({
      workspace: workspaceKey(),
      ready: terminal().ready(),
      active: terminal().active(),
      ptys: terminal().all(),
    }),
    (current) => {
      if (!current.ready) return

      const ids = new Set(current.ptys.map((pty) => pty.id))

      const surfaces = store.surfaces.filter(
        (surface) => surface.workspace !== current.workspace || ids.has(surface.pty.id),
      )

      const pty = current.ptys.find((item) => item.id === current.active)
      const key = pty ? `${current.workspace}\0${pty.id}` : undefined

      if (pty && key && !surfaces.some((surface) => surface.key === key)) {
        surfaces.push({
          key,
          workspace: current.workspace,
          pty,
          ops: terminal(),
          focus: terminal().focusRequested(pty.id),
        })
      }

      const workspaces = [...store.workspaces.filter((item) => item !== current.workspace), current.workspace].slice(
        -MAX_CACHED_TERMINAL_WORKSPACES,
      )

      const keep = new Set(workspaces)

      setStore({ surfaces: surfaces.filter((surface) => keep.has(surface.workspace)), workspaces })
    },
    {
      equals: (previous, next) =>
        previous.workspace === next.workspace &&
        previous.ready === next.ready &&
        previous.active === next.active &&
        previous.ptys === next.ptys,
    },
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

    if (!opened() || terminal().active() !== id) return
    focusTerminalById(id)
    terminal().consumeFocus(id)
  }

  const handleTerminalDragEnd = () => {
    const activeId = terminal().active()

    if (!activeId) return
    requestAnimationFrame(() => {
      if (terminal().active() !== activeId) return
      focusTerminalById(activeId)
    })
  }

  return (
    <Show
      when={terminal().ready() || store.surfaces.length > 0}
      fallback={
        <div class="flex flex-col h-full pointer-events-none">
          <div
            class="h-10 flex items-center gap-2 px-2 border-b border-border-weaker-base bg-v2-background-bg-base overflow-hidden"
            classList={{ "pe-12": frame.reserve() }}
          >
            <For each={handoff()}>
              {(title) => (
                <div class="px-2 py-1 rounded-md bg-surface-base text-14-regular text-text-weak truncate max-w-40">
                  {title}
                </div>
              )}
            </For>
            <div class="flex-1" />
            <div class="text-text-weak pr-2">
              {extension.t("common.loading")}
              {extension.t("common.loading.ellipsis")}
            </div>
          </div>
          <div class="flex-1 flex items-center justify-center text-text-weak">{extension.t("loading")}</div>
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
            terminal().move(source.id.toString(), source.index)
          }

          handleTerminalDragEnd()
        }}
      >
        <div class="flex flex-col h-full">
          <div class="h-[52px] shrink-0 flex border-b border-border-weaker-base">
            <Tabs
              variant="panel"
              value={terminal().active()}
              onChange={(id) => terminal().open(id)}
              class="!h-full min-w-0 !flex-1"
            >
              <Tabs.List
                ref={tabList}
                class="!border-b-0"
                onPointerDown={(event: PointerEvent & { currentTarget: HTMLDivElement }) => {
                  const active = document.activeElement

                  if (event.target === active) return

                  if (active instanceof HTMLInputElement && event.currentTarget.contains(active)) active.blur()
                }}
              >
                <For each={all()}>
                  {(pty, index) => (
                    <SortableTerminalTab terminal={pty} workspace={terminal()} index={index()} onClose={close} />
                  )}
                </For>
                <div class="h-full flex items-center justify-center">
                  <Tooltip
                    value={
                      <>
                        {extension.t("command.new")}
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
                      onClick={() => terminal().new()}
                      aria-label={extension.t("command.new")}
                    />
                  </Tooltip>
                </div>
              </Tabs.List>
            </Tabs>
            {/* Reserve outside the scroll viewport so overflowing tabs cannot cover the toggle. */}
            <Show when={frame.reserve()}>
              <div class="w-12 shrink-0" aria-hidden />
            </Show>
          </div>
          <div class="flex-1 min-h-0 relative">
            <For each={store.surfaces}>
              {(surface) => (
                <div
                  id={`terminal-wrapper-${surface.pty.id}`}
                  class="absolute inset-0"
                  classList={{
                    hidden:
                      !present() || surface.workspace !== workspaceKey() || surface.pty.id !== terminal().active(),
                  }}
                >
                  <Terminal
                    pty={surface.pty}
                    server={surface.ops.server()}
                    directory={surface.ops.directory}
                    ghostty={props.model.ghostty}
                    autoFocus={terminal().focusRequested(surface.pty.id)}
                    onAutoFocus={() => {
                      focusTerminalById(surface.pty.id)
                      terminal().consumeFocus(surface.pty.id)
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
  )
}
