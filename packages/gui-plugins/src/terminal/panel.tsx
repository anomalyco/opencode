import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Tabs } from "@opencode/ui/tabs"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { Keybind } from "@opencode/ui/keybind"
import { uuid } from "@opencode/util/uuid"
import { createKeyed, usePlugin, usePanel, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import type { TerminalModel } from "./model"
import { TerminalTab } from "./tab"
import { Terminal } from "./terminal"
import { focusTerminalById } from "./focus"
import type { TerminalQuoteTarget } from "./quote"
import {
  initialSurfaceState,
  surfaceAt,
  surfaceMounts,
  surfaceShown,
  transitionSurface,
  type SurfaceEvent,
} from "./surface-machine"

/**
 * The routed session's terminals. In the side region each terminal is its own strip tab and `tab` names the one to
 * show; the narrow-screen view has no strip, so it lists the terminals in its own tabs.
 */
export default function TerminalPanel(props: {
  model: TerminalModel
  session: MountedSession
  screen: SessionScreen
  tab: () => string
}) {
  const plugin = usePlugin()
  const keybinds = plugin.keybinds
  const frame = usePanel()
  const terminal = createMemo(() => props.model.load(props.session))
  const opened = frame.visible
  const present = frame.present
  const mobile = () => frame.placement() === "mobile"
  const active = () => (mobile() ? terminal().active() : terminal().get(props.tab())?.id)

  const failed = () => {
    const view = terminal().view()

    return view.type === "failed" ? view : undefined
  }

  // Selected output quotes into the composer of the screen showing this panel.
  const quote: TerminalQuoteTarget = {
    available: () => opened() && props.screen.composer.quotable(),
    add(text, anchor) {
      const composer = props.screen.composer
      const commentID = uuid()

      composer.attach({
        type: "quote",
        commentID,
        text,
        source: { label: plugin.t("quote.label"), icon: "terminal", subject: "the terminal" },
      })
      composer.focus(anchor ? commentID : undefined, { anchor })
    },
  }

  onCleanup(() => terminal().cancelFocus())

  const [surfaceState, setSurfaceState] = createSignal(initialSurfaceState)

  const dispatch = (event: SurfaceEvent) => {
    const previous = untrack(surfaceState)
    const next = transitionSurface(previous, event)

    if (next.state !== previous) setSurfaceState(next.state)
    next.effects.forEach(() => void untrack(terminal).new())
  }

  const newTerminalKeybind = createMemo(() => [...keybinds.keybind("terminal.new")])

  // Focuses the shown terminal once the panel is visible and a focus request names it.
  createKeyed(
    () => {
      const id = active()

      return opened() && id ? terminal().focusRequest(id) : undefined
    },
    (request) => {
      const id = untrack(active)

      const focusFrame = requestAnimationFrame(() => {
        if (!id || !opened() || active() !== id || terminal().focusRequest(id) !== request) return

        focusTerminalById(id)
        const input = document.getElementById(`terminal-wrapper-${id}`)?.querySelector("textarea")

        if (input === document.activeElement) terminal().consumeFocus(id)
      })

      onCleanup(() => cancelAnimationFrame(focusFrame))
    },
  )

  // Terminals whose tabs the user moved to another pane render there, so this pane lets their screens go.
  const elsewhere = createMemo(
    () => {
      if (mobile()) return new Set<string>()
      const open = frame.open()

      return new Set(plugin.layout.stored(props.session).filter((id) => !open.includes(id)))
    },
    new Set<string>(),
    { equals: (previous, next) => previous.size === next.size && [...next].every((id) => previous.has(id)) },
  )

  // Mounts the terminals the session shows, and their sockets, through the surface machine. The narrow-screen view also
  // creates the first terminal of a session it finds empty.
  createKeyed(
    () => {
      const current = terminal()

      return {
        session: current.key,
        ready: current.view().type === "ready",
        connection: current.connection(),
        opened: opened(),
        mobile: mobile(),
        active: active() ?? null,
        terminals: current.all(),
        elsewhere: elsewhere(),
      }
    },
    (current) =>
      dispatch({
        type: "sync",
        session: current.session,
        ready: current.ready,
        connection: current.connection,
        opened: current.opened,
        mobile: current.mobile,
        active: current.active,
        terminalIDs: current.terminals.map((info) => info.id),
        elsewhere: current.elsewhere,
      }),
    {
      equals: (previous, next) =>
        previous.session === next.session &&
        previous.ready === next.ready &&
        previous.connection === next.connection &&
        previous.opened === next.opened &&
        previous.mobile === next.mobile &&
        previous.active === next.active &&
        previous.terminals === next.terminals &&
        previous.elsewhere === next.elsewhere,
    },
  )

  const surfaces = () => (
    <div class="flex-1 min-h-0 relative">
      <For each={surfaceMounts(surfaceState())}>
        {(mount) => {
          // A mount stays in its session, so its server is the one it mounted with.
          const session = untrack(terminal)

          return (
            <Show when={surfaceAt(surfaceState(), mount)}>
              {(surface) => (
                <div
                  id={`terminal-wrapper-${surface().id}`}
                  class="absolute inset-0"
                  // Mod+W closes the selected terminal, so the one in use is selected when two panes show terminals.
                  onFocusIn={() => terminal().select(surface().id)}
                  onPointerDown={() => terminal().select(surface().id)}
                  classList={{ hidden: !present() || !surfaceShown(surfaceState(), surface()) }}
                >
                  <Terminal
                    ptyID={surface().id}
                    server={session.server()}
                    ghostty={props.model.ghostty}
                    quote={quote}
                    autoFocus={terminal().focusRequested(surface().id)}
                    onAutoFocus={() => terminal().consumeFocus(surface().id)}
                    onFailure={() => dispatch({ type: "surface.failed", mount })}
                    class="!px-[14px]"
                  />
                </div>
              )}
            </Show>
          )
        }}
      </For>
    </div>
  )

  return (
    <div id="terminal-panel" class="flex flex-col size-full">
      <Switch
        fallback={
          <div class="flex-1 flex items-center justify-center text-text-weak pointer-events-none">
            {plugin.t("loading")}
          </div>
        }
      >
        <Match when={failed()}>
          {(view) => (
            <div role="alert" class="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
              <div class="flex flex-col gap-1">
                <div class="text-13-regular text-text-strong">{plugin.t("list.failed")}</div>
                <div class="text-12-regular text-text-weak break-words">{view().error}</div>
              </div>
              <Button size="small" variant="outline" onClick={() => void terminal().retry()}>
                {plugin.t("common.retry")}
              </Button>
            </div>
          )}
        </Match>
        <Match when={terminal().view().type === "unsupported"}>
          <div class="flex-1 flex items-center justify-center px-4 text-center text-text-weak pointer-events-none">
            {plugin.t("unavailable")}
          </div>
        </Match>
        <Match when={terminal().view().type === "ready"}>
          <Show when={mobile()} fallback={surfaces()}>
            <div class="h-[49px] shrink-0 flex border-b border-v2-border-border-base">
              <Tabs
                variant="panel"
                value={terminal().active()}
                onChange={(id) => terminal().select(id)}
                class="!h-full min-w-0 !flex-1"
              >
                <Tabs.List
                  class="!border-b-0"
                  onPointerDown={(event: PointerEvent & { currentTarget: HTMLDivElement }) => {
                    const focused = document.activeElement

                    if (event.target === focused) return

                    if (focused instanceof HTMLInputElement && event.currentTarget.contains(focused)) focused.blur()
                  }}
                >
                  <For each={terminal().all()}>
                    {(info) => (
                      <TerminalTab
                        terminal={info}
                        session={terminal()}
                        rename={(title) => void terminal().rename(info.id, title)}
                      />
                    )}
                  </For>
                  <div class="h-full flex items-center justify-center">
                    <Tooltip
                      value={
                        <>
                          {plugin.t("command.new")}
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
                        aria-label={plugin.t("command.new")}
                      />
                    </Tooltip>
                  </div>
                </Tabs.List>
              </Tabs>
            </div>
            {surfaces()}
          </Show>
        </Match>
      </Switch>
    </div>
  )
}
