import { createMemo, lazy, onCleanup, Show, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import {
  Command,
  createKeyed,
  MenuItem,
  Panel,
  Style,
  type MountedSession,
  type PanelTab,
  type Plugin,
  type SessionRef,
} from "@opencode/plugin/gui"
import type Terminal from "./index"
import { terminalToggleCommand } from "./index"
import { createTerminalModel, type TerminalSession } from "./model"
import { terminalTabLabel } from "./title"
import { TerminalTabLabel } from "./label"
import quoteStyles from "./quote.css?inline"
import { onIdle, BuiltinCommand, BuiltinSlot } from "@opencode/plugin/gui/builtin"

const setup: Plugin.Setup<typeof Terminal> = (ctx) => {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const key = (id: string) => `${ctx.id}:${id}`
  const model = createTerminalModel({ storage: ctx.storage, layout, toast: ctx.toast, t: ctx.t, tab: key })

  onCleanup(model.dispose)
  ctx.add(Style, quoteStyles)
  // The host withdraws the listener with the plugin.
  ctx.workspaces.on("remove", model.remove)

  const current = () => {
    const session = sessions.current()

    if (!session) return

    return { session, terminal: model.load(session) }
  }

  // Servers without persistent terminals get no terminal commands, like the TUI.
  const enabled = createMemo(() => {
    const session = sessions.current()

    return !!session && model.available(session.server)
  })

  // Opens a terminal's tab in the session's side panel and focuses it.
  const show = (session: MountedSession, terminal: TerminalSession, id: string) => {
    terminal.select(id)
    terminal.requestFocus(id)
    // A narrow screen shows the terminal view; a wide one adds the tab without replacing the preview tab.
    layout.open(key(id), session, layout.narrow() ? undefined : { tab: "select" })
  }

  const create = (session: MountedSession, terminal: TerminalSession) =>
    void terminal.new().then((id) => {
      if (id && !ctx.signal.aborted) show(session, terminal, id)
    })

  ctx.add(BuiltinSlot, {
    at: "session.location.branch.menu",
    render: (input) => (
      <Show when={model.available(input.session.server)}>
        <Menu.Item onSelect={() => create(input.session, model.load(input.session))}>
          <Icon name="outline-console" class="text-v2-icon-icon-muted" />
          {ctx.t("location.open")}
        </Menu.Item>
      </Show>
    ),
  })

  ctx.add(
    Command,
    (): Command => ({
      ...terminalToggleCommand,
      title: ctx.t("command.toggle"),
      group: ctx.t("command.category.view"),
      section: "terminal",
      featured: true,
      slash: { name: "terminal", after: "open" },
      editable: true,
      enabled: enabled(),
      run() {
        const target = current()

        if (!target) return

        const id = target.terminal.active()

        if (!id) return create(target.session, target.terminal)

        // A visible tab hides with its pane; a narrow screen has no strip, so there the command only shows it.
        if (!layout.narrow() && layout.state(key(id), target.session) === "visible") {
          target.terminal.cancelFocus()
          layout.hide(key(id), target.session)

          return
        }

        show(target.session, target.terminal, id)
      },
    }),
  )

  ctx.add(
    Command,
    (): Command => ({
      id: "new",
      title: ctx.t("command.new"),
      description: ctx.t("command.new.description"),
      group: ctx.t("command.category"),
      section: "terminal",
      bind: "ctrl+alt+t",
      editable: true,
      enabled: enabled(),
      run() {
        const target = current()

        if (target) create(target.session, target.terminal)
      },
    }),
  )

  ctx.add(
    BuiltinCommand,
    (): BuiltinCommand => ({
      id: "close",
      title: ctx.t("close"),
      group: ctx.t("command.category"),
      section: "terminal",
      bind: "mod+w",
      follows: "tab.close",
      hidden: true,
      scope: '[data-component="terminal"]',
      enabled: enabled(),
      run() {
        const target = current()
        const id = target?.terminal.active()

        if (target && id) void target.terminal.close(id)
      },
    }),
  )

  ctx.add(MenuItem, (): MenuItem | undefined => {
    if (!enabled()) return

    return {
      menu: "session.panel",
      id: "new",
      title: ctx.t("tab.title"),
      icon: "terminal",
      keybind: "terminal.new",
      order: 20,
      run() {
        const target = current()

        if (target) create(target.session, target.terminal)
      },
    }
  })

  const TerminalPanel = lazy(() => import("./panel"))

  // Warms the panel chunk so the first terminal tab has no blank frame. ghostty-web still loads on the first terminal.
  onCleanup(onIdle(() => void TerminalPanel.preload()))
  // A terminal tab stored in a strip renders with its session at startup, so its chunk loads with the app.
  createKeyed(
    () => sessions.list().some((session) => layout.stored(session).length > 0),
    () => void TerminalPanel.preload(),
  )

  // Tab objects per session and terminal, reused so strip updates and session switches do not rebuild a trigger.
  const tabs = new Map<string, Map<string, PanelTab>>()

  // Drops the tab objects of sessions whose shell tab closed.
  createKeyed(
    () => [...sessions.list().map((session) => session.key), sessions.current()?.key].join("\u0000"),
    () => {
      const keep = new Set([...sessions.list().map((session) => session.key), sessions.current()?.key])
      tabs.forEach((_cache, cacheKey) => {
        if (!keep.has(cacheKey)) tabs.delete(cacheKey)
      })
    },
  )

  const tab = (session: SessionRef, id: string): PanelTab => {
    const terminal = () => model.load(session)
    const info = () => terminal().get(id)
    const label = () => terminalTabLabel({ title: info()?.title, t: ctx.t })

    return {
      id,
      get title() {
        return label()
      },
      // Listed only to hold the restored selection until the server lists the session's terminals.
      get hidden() {
        return !terminal().ready()
      },
      group: "terminal",
      label: () => (
        <TerminalTabLabel
          label={label()}
          title={info()?.title ?? ""}
          rename={(title) => void terminal().rename(id, title)}
          close={() => void terminal().close(id)}
        />
      ),
    }
  }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    // A tab whose terminal the server no longer lists (closed here or elsewhere, or exited) leaves the strip.
    transient: true,
    mobile: {
      get title() {
        return ctx.t("tab.title")
      },
      order: 30,
      kind: "menu",
      icon: "terminal",
      cached: true,
    },
    // One tab per terminal of the session. Until the server lists them, the stored tabs stay listed but hidden so
    // restore keeps them.
    list: (input) => {
      const terminal = model.load(input.session)
      const ids = [...new Set([...input.open, ...terminal.all().map((info) => info.id)])]

      if (ids.length === 0) return []

      const cache = tabs.get(input.session.key) ?? new Map<string, PanelTab>()
      tabs.set(input.session.key, cache)

      return ids.flatMap((id) => {
        if (terminal.ready() && !terminal.get(id)) {
          cache.delete(id)

          return []
        }

        const existing = cache.get(id)

        if (existing) return [existing]

        const created = tab(input.session, id)
        cache.set(id, created)

        return [created]
      })
    },
    render: (props) => (
      <Suspense>
        <TerminalPanel model={model} session={props.session} screen={props.screen} tab={() => props.tab.id} />
      </Suspense>
    ),
    close: (input) => {
      const terminal = model.load(input.session)

      tabs.get(input.session.key)?.delete(input.tab.id)

      if (terminal.get(input.tab.id)) void terminal.close(input.tab.id)
    },
    // Before the server lists the session's terminals, a restored tab is selected on trust; `active` honours the
    // selection once it is listed.
    focus: (input) => {
      const terminal = model.load(input.session)

      if (terminal.ready() && !terminal.get(input.tab.id)) return

      terminal.select(input.tab.id)

      if (!input.restored) terminal.requestFocus(input.tab.id)
    },
    enter: (input) => {
      const terminal = model.load(input.session)

      if (!terminal.ready() || terminal.get(input.tab.id)) terminal.requestFocus(input.tab.id)
    },
  })
}

export default setup
