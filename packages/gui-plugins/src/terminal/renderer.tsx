import { createMemo, lazy, on, onCleanup, Suspense } from "solid-js"
import {
  Command,
  createKeyed,
  MenuItem,
  Panel,
  Style,
  type MountedSession,
  type PanelTab,
  type Plugin,
} from "@opencode/plugin/gui"
import type Terminal from "./index"
import { terminalToggleCommand } from "./index"
import { createTerminalModel, type TerminalWorkspace } from "./model"
import { terminalTab, type LocalPTY } from "./state"
import { terminalTabLabel } from "./title"
import { TerminalTabLabel } from "./label"
import quoteStyles from "./quote.css?inline"
import { onIdle, BuiltinCommand } from "@opencode/plugin/gui/builtin"

const setup: Plugin.Setup<typeof Terminal> = (ctx) => {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const model = createTerminalModel({ storage: ctx.storage, sessions })
  const key = (id: string) => `${ctx.id}:${id}`

  onCleanup(model.dispose)
  ctx.add(Style, quoteStyles)
  // The host withdraws the listener with the plugin.
  ctx.workspaces.on("remove", model.remove)

  // The routed session's workspace stays loaded while no panel renders it, like the session route did.
  const workspace = createMemo<TerminalWorkspace | undefined>((previous) => {
    const session = sessions.current()

    return session ? model.load(session) : previous
  })

  // The workspace each later route change leaves.
  const left = createMemo(
    on(workspace, (next, previous) => (previous && next !== previous ? previous : undefined), { defer: true }),
  )

  // A workspace the route leaves drops its restore buffers.
  createKeyed(left, (previous) => previous.trimAll())

  const routed = createMemo(() => !!sessions.current())

  const current = () => {
    const session = sessions.current()

    if (!session) return

    return { session, terminal: model.load(session) }
  }

  // Opens a terminal's tab in the session's side panel and focuses it.
  const show = (session: MountedSession, terminal: TerminalWorkspace, pty: LocalPTY) => {
    terminal.open(pty.id)
    terminal.requestFocus(pty.id)
    // A narrow screen shows the terminal view; a wide one adds the tab without replacing the preview tab.
    layout.open(key(terminalTab(pty)), session, layout.narrow() ? undefined : { tab: "select" })
  }

  const create = (session: MountedSession, terminal: TerminalWorkspace) =>
    void terminal.new().then((id) => {
      const pty = id ? terminal.all().find((item) => item.id === id) : undefined

      if (pty) show(session, terminal, pty)
    })

  // Closes the tab, which closes its terminal; the narrow-screen view lists terminals without storing their tabs.
  const close = (session: MountedSession, terminal: TerminalWorkspace, pty: LocalPTY) => {
    layout.close(key(terminalTab(pty)), session)

    if (terminal.all().some((item) => item.id === pty.id)) void terminal.close(pty.id)
  }

  const active = (terminal: TerminalWorkspace) => terminal.all().find((pty) => pty.id === terminal.active())

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
      enabled: routed(),
      run() {
        const target = current()

        if (!target) return

        const pty = active(target.terminal)

        if (!pty) return create(target.session, target.terminal)

        // A visible tab hides with its pane; a narrow screen has no strip, so there the command only shows it.
        if (!layout.narrow() && layout.state(key(terminalTab(pty)), target.session) === "visible") {
          target.terminal.cancelFocus()
          layout.hide(key(terminalTab(pty)), target.session)

          return
        }

        show(target.session, target.terminal, pty)
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
      enabled: routed(),
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
      enabled: routed(),
      run() {
        const target = current()
        const pty = target ? active(target.terminal) : undefined

        if (target && pty) close(target.session, target.terminal, pty)
      },
    }),
  )

  ctx.add(MenuItem, {
    menu: "session.panel",
    id: "new",
    get title() {
      return ctx.t("tab.title")
    },
    icon: "terminal",
    keybind: "terminal.new",
    order: 20,
    run() {
      const target = current()

      if (target) create(target.session, target.terminal)
    },
  })

  const TerminalPanel = lazy(() => import("./panel"))

  // Warms the panel chunk so the first terminal tab has no blank frame. ghostty-web still loads on the first terminal.
  onCleanup(onIdle(() => void TerminalPanel.preload()))
  // A terminal tab stored in a strip renders with its session at startup, so its chunk loads with the app.
  createKeyed(
    () => sessions.list().some((session) => layout.stored(session).length > 0),
    () => void TerminalPanel.preload(),
  )

  // Tab objects per session, workspace and terminal, reused so strip updates and session switches do not rebuild a
  // trigger.
  const tabs = new Map<string, Map<string, PanelTab>>()

  // Drops the tab objects of sessions whose shell tab closed.
  createKeyed(
    () => [...sessions.list().map((session) => session.key), sessions.current()?.key].join("\u0000"),
    () => {
      const keep = new Set([...sessions.list().map((session) => session.key), sessions.current()?.key])
      tabs.forEach((_cache, cacheKey) => {
        if (!keep.has(cacheKey.slice(0, cacheKey.indexOf("\0")))) tabs.delete(cacheKey)
      })
    },
  )

  const tab = (workspace: Pick<MountedSession, "server" | "directory">, id: string): PanelTab => {
    const terminal = () => model.load(workspace)
    const pty = () => terminal().byTab(id)
    const label = () => terminalTabLabel({ title: pty()?.title, titleNumber: pty()?.titleNumber, t: ctx.t })

    return {
      id,
      get title() {
        return label()
      },
      // Listed only to hold the restored selection until the workspace's stored terminals load.
      get hidden() {
        return !terminal().ready()
      },
      group: "terminal",
      label: (state) => (
        <TerminalTabLabel
          label={label()}
          title={pty()?.title ?? ""}
          rename={(title) => {
            const current = pty()

            if (current) terminal().update({ id: current.id, title })
          }}
          close={() => {
            const current = pty()

            if (current) close(state.session, terminal(), current)
          }}
        />
      ),
    }
  }

  ctx.add(Panel, {
    id: "main",
    region: "side",
    // A tab whose terminal exited, or was closed from another session of the workspace, leaves the strip.
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
    // One tab per terminal of the session's workspace; the strip shows those opened in this session. Listing the rest
    // keeps their shared render, and so their shells' screens, mounted while another session of the workspace is
    // routed. Until the workspace's terminals load, the stored tabs stay listed but hidden so restore keeps them.
    list: (input) => {
      const terminal = model.load(input.session)
      const ids = [...new Set([...input.open, ...terminal.all().map(terminalTab)])]

      if (ids.length === 0) return []

      const workspace = { server: input.session.server, directory: input.session.directory }
      const cacheKey = `${input.session.key}\0${terminal.key}`
      const cache = tabs.get(cacheKey) ?? new Map<string, PanelTab>()
      tabs.set(cacheKey, cache)

      return ids.flatMap((id) => {
        if (terminal.ready() && !terminal.byTab(id)) {
          cache.delete(id)

          return []
        }

        const existing = cache.get(id)

        if (existing) return [existing]

        const created = tab(workspace, id)
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
      const pty = terminal.byTab(input.tab.id)

      tabs.get(`${input.session.key}\0${terminal.key}`)?.delete(input.tab.id)

      if (pty) void terminal.close(pty.id)
    },
    focus: (input) => {
      const terminal = model.load(input.session)
      const pty = terminal.byTab(input.tab.id)

      if (!pty) return

      terminal.open(pty.id)

      if (!input.restored) terminal.requestFocus(pty.id)
    },
    enter: (input) => {
      const terminal = model.load(input.session)
      const pty = terminal.byTab(input.tab.id)

      if (pty) terminal.requestFocus(pty.id)
    },
  })
}

export default setup
