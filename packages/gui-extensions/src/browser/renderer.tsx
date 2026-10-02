import { createEffect, createSignal, getOwner, lazy, runWithOwner, Show, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { App, Command, Link, Menu, onIdle, Panel, Sessions, Style, type PanelTab, type Setup } from "../sdk"
import { Browser } from "./contract"
import type { Model } from "./model"
import commentStyles from "./comment.css?inline"
import tabStyles from "./tabs.css?inline"

const setup: Setup = (ctx) => {
  const sessions = ctx.use(Sessions)
  const [model, setModel] = createSignal<Model>()
  // Settings > Shortcuts lists the command on every platform; it stays disabled until the pane can open.
  ctx.add(Command, (): Command | undefined => {
    const view = sessions.current()
    if (!view) return undefined
    const value = model()
    return {
      id: "open",
      title: ctx.t("command.open"),
      group: ctx.t("command.category.view"),
      bind: "mod+shift+b",
      enabled: !!value?.available(view),
      run: () => value?.open(view),
    }
  })
  // The native pane is a desktop feature.
  if (ctx.use(App).platform !== "desktop") return
  // Tab trigger styles render with the strip, before the pane chunk loads.
  ctx.add(Style, tabStyles)
  ctx.add(Style, commentStyles)
  const owner = getOwner()
  const status = { requested: false }
  // Everything here serves a mounted session, so the attachment model and the pane's protocol
  // schemas load when the first session opens instead of at startup.
  createEffect(() => {
    if (status.requested || !sessions.current()) return
    status.requested = true
    void import("./model").then((module) => {
      if (ctx.signal.aborted) return
      const created = runWithOwner(owner, () => module.createModel(ctx))
      setModel(() => created)
    })
  })

  ctx.provide(Browser, {
    attached: (session) => model()?.attached(session) ?? false,
    canOpen: (session, path) => model()?.canOpen(session, path) ?? false,
    open: (session, url) => model()?.openURL(session, url),
    openFile: (session, path) => model()?.openFile(session, path),
  })

  ctx.add(Command, (): Command | undefined => {
    const pane = model()?.pane()
    if (!pane) return undefined
    return {
      id: "reload",
      title: ctx.t("command.reload"),
      group: ctx.t("command.category.view"),
      bind: "f5",
      editable: true,
      enabled: pane.visible() && !!pane.address(),
      run: pane.reload,
    }
  })

  // Ctrl+Shift+C copies in the terminal, so only the focused page claims it, as in Chromium.
  ctx.add(Command, (): Command | undefined => {
    const pane = model()?.pane()
    if (!pane) return undefined
    return {
      id: "inspect",
      title: ctx.t("command.inspect"),
      group: ctx.t("command.category.view"),
      enabled: pane.visible() && pane.inspectable(),
      run: pane.inspect,
    }
  })

  ctx.add(Menu, (): Menu | undefined => {
    const view = sessions.current()
    const value = model()
    if (!view || !value?.available(view)) return undefined
    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("tab.title"),
      icon: "globe",
      keybind: "browser.open",
      order: 20,
      run: () => value.open(view),
    }
  })

  ctx.add(Link, {
    priority: 10,
    match: (link) => !!model()?.match(link),
    open: (link) => model()?.openLink(link),
  })
  // A composer chip for a comment on a picked element.
  ctx.add(Link, {
    priority: 10,
    match: (link) => link.origin === ctx.id && !!link.session,
    open(link) {
      if (link.session) model()?.reveal(link.session, link.href)
    },
  })

  // Stable tab objects with live labels, so title and URL changes never remount a trigger.
  const tabs = new Map<string, Map<string, PanelTab>>()
  const create = (session: string, id: string): PanelTab => {
    const text = () => {
      const tab = model()?.tab({ key: session }, id)
      return !tab?.url || tab.url === "about:blank" ? ctx.t("tab.title") : tab.title || tab.url
    }
    return {
      id,
      get title() {
        return text()
      },
      label: () => (
        <div class="flex items-center gap-1.5">
          <Icon name="globe" size="small" />
          <span class="max-w-40 truncate">{text()}</span>
        </div>
      ),
      // Listed only to hold the restored selection until the desktop's first inventory names the tab.
      get hidden() {
        return !model()?.tab({ key: session }, id)
      },
      group: "browser",
      dom: { tab: `session-side-panel-browser-tab-${id}`, panel: "session-side-panel-browser-tabpanel" },
    }
  }
  const SessionBrowserPane = lazy(() => import("./panel"))
  ctx.cleanup(onIdle(() => void SessionBrowserPane.preload()))
  ctx.add(Panel, {
    id: "main",
    region: "side",
    list(session, open) {
      // While the model loads, the stored tabs hold the strip and its selection, as before the first inventory.
      const ids = model()?.tabs(session, open) ?? open
      if (ids.length === 0) {
        tabs.delete(session.key)
        return []
      }
      const previous = tabs.get(session.key)
      const next = new Map(ids.map((id) => [id, previous?.get(id) ?? create(session.key, id)]))
      tabs.set(session.key, next)
      return [...next.values()]
    },
    // The pane shows nothing until the desktop's first inventory names its tabs.
    render: (tab, session) => (
      <Show when={model()}>
        {(value) => (
          <Show when={!value().pending(session)}>
            <Suspense>
              <SessionBrowserPane tab={tab} session={session} model={value()} />
            </Suspense>
          </Show>
        )}
      </Show>
    ),
    close: (tab, session) => model()?.closeTab(session, tab.id),
    focus: (tab, session) => model()?.focusTab(session, tab.id),
  })
}

export default setup
