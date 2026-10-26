import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
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
import { createKeyed, useExtension, usePanel, type MountedSession, type SessionScreen } from "../sdk"
import type { TerminalModel, TerminalWorkspace } from "./model"
import { terminalTab, type LocalPTY } from "./state"
import { SortableTerminalTab } from "./tab"
import { Terminal } from "./terminal"
import { terminalTabLabel } from "./title"
import { focusTerminalById } from "./focus"
import type { TerminalQuoteTarget } from "./quote"

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

/**
 * The terminals of the routed session's workspace. In the side region each terminal is its own strip tab and `tab`
 * names the one to show; the narrow-screen view has no strip, so it lists the terminals in its own tabs.
 */
export default function TerminalPanel(props: {
  model: TerminalModel
  session: MountedSession
  screen: SessionScreen
  tab: () => string
}) {
  const extension = useExtension()
  const keybinds = extension.keybinds
  const frame = usePanel()
  const terminal = createMemo(() => props.model.load(props.session))
  const workspaceKey = () => terminal().key
  const opened = frame.visible
  const present = frame.present
  const mobile = () => frame.placement() === "mobile"
  const active = () => (mobile() ? terminal().active() : terminal().byTab(props.tab())?.id)
  let tabList: HTMLDivElement | undefined

  // Selected output quotes into the composer of the screen showing this panel.
  const quote: TerminalQuoteTarget = {
    available: () => props.screen.composer.quotable(),
    add(text, comment) {
      const composer = props.screen.composer
      const commentID = crypto.randomUUID()

      composer.attach({
        type: "quote",
        commentID,
        text,
        source: { label: extension.t("quote.label"), icon: "terminal", subject: "the terminal" },
      })
      composer.focus(comment ? commentID : undefined)
    },
  }

  onCleanup(() => terminal().cancelFocus())

  const [store, setStore] = createStore<TerminalPanelState>({ recovered: {}, surfaces: [], workspaces: [] })

  const newTerminalKeybind = createMemo(() => [...keybinds.keybind("terminal.new")])

  onMount(() => {
    makeEventListener(document, "focusin", (event) => {
      if (event.target instanceof Element && event.target.closest("#terminal-panel")) return

      setStore("surfaces", (surface) => surface.focus, "focus", false)
    })
  })

  // While the narrow-screen view shows, a workspace first observed empty gets its first terminal, once per workspace in
  // a row. In the side region the user opens each terminal from the strip.
  createKeyed(
    () => opened() && mobile(),
    () => {
      const seen = { workspace: "" }

      createKeyed(
        () => {
          const workspace = terminal()

          return workspace.ready() ? workspace : undefined
        },
        (workspace) => {
          if (seen.workspace === workspace.key) return

          seen.workspace = workspace.key

          if (workspace.all().length === 0) void workspace.new()
        },
      )
    },
  )

  // Focuses the shown terminal once the panel is visible and a focus request names it.
  createKeyed(
    () => {
      const id = active()

      return opened() && id && terminal().focusRequested(id) ? { id } : undefined
    },
    (request) =>
      requestAnimationFrame(() => {
        if (!opened() || active() !== request.id || !terminal().focusRequested(request.id)) return

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

  // Terminals whose tabs the user moved to another pane render there, so this pane lets their screens go.
  const elsewhere = createMemo(
    () => {
      if (mobile()) return new Set<string>()
      const open = frame.open()

      return new Set(extension.layout.stored(props.session).filter((id) => !open.includes(id)))
    },
    new Set<string>(),
    { equals: (previous, next) => previous.size === next.size && [...next].every((id) => previous.has(id)) },
  )

  // Keeps each shown terminal mounted for the workspaces shown last, so switching back keeps its screen and session. A
  // terminal mounts, and connects, once it is shown, not while the panel only holds its tab hidden.
  createKeyed(
    () => ({
      workspace: workspaceKey(),
      ready: terminal().ready(),
      active: opened() ? active() : undefined,
      ptys: terminal().all(),
      elsewhere: elsewhere(),
    }),
    (current) => {
      if (!current.ready) return

      const ids = new Set(current.ptys.map((pty) => pty.id))

      const surfaces = store.surfaces.filter(
        (surface) =>
          surface.workspace !== current.workspace ||
          (ids.has(surface.pty.id) && !current.elsewhere.has(terminalTab(surface.pty))),
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
        previous.ptys === next.ptys &&
        previous.elsewhere === next.elsewhere,
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

    if (!opened() || active() !== id) return
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

  const surfaces = () => (
    <div class="flex-1 min-h-0 relative">
      <For each={store.surfaces}>
        {(surface) => (
          <div
            id={`terminal-wrapper-${surface.pty.id}`}
            class="absolute inset-0"
            classList={{
              hidden: !present() || surface.workspace !== workspaceKey() || surface.pty.id !== active(),
            }}
          >
            <Terminal
              pty={surface.pty}
              server={surface.ops.server()}
              directory={surface.ops.directory}
              ghostty={props.model.ghostty}
              quote={quote}
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
  )

  return (
    <div id="terminal-panel" class="flex flex-col size-full">
      <Show
        when={terminal().ready() || store.surfaces.length > 0}
        fallback={
          <div class="flex flex-col h-full pointer-events-none">
            <Show when={mobile()}>
              <div class="h-10 flex items-center gap-2 px-2 border-b border-v2-border-border-base bg-v2-background-bg-base overflow-hidden">
                <For each={handoff()}>
                  {(title) => (
                    <div class="px-2 py-1 rounded-md bg-surface-base text-14-regular text-text-weak truncate max-w-40">
                      {title}
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="flex-1 flex items-center justify-center text-text-weak">{extension.t("loading")}</div>
          </div>
        }
      >
        <Show when={mobile()} fallback={surfaces()}>
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
            <div class="h-[49px] shrink-0 flex border-b border-v2-border-border-base">
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
                    const focused = document.activeElement

                    if (event.target === focused) return

                    if (focused instanceof HTMLInputElement && event.currentTarget.contains(focused)) focused.blur()
                  }}
                >
                  <For each={terminal().all()}>
                    {(pty, index) => <SortableTerminalTab terminal={pty} workspace={terminal()} index={index()} />}
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
                        onClick={() => void terminal().new()}
                        aria-label={extension.t("command.new")}
                      />
                    </Tooltip>
                  </div>
                </Tabs.List>
              </Tabs>
            </div>
            {surfaces()}
          </DragDropProvider>
        </Show>
      </Show>
    </div>
  )
}
