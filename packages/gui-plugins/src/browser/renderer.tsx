import {
  createMemo,
  createSignal,
  getOwner,
  lazy,
  Match,
  onCleanup,
  runWithOwner,
  Show,
  Suspense,
  Switch,
  untrack,
} from "solid-js"
import { Button } from "@opencode/ui/button"
import { Loader } from "@opencode/ui/loader"
import { Command, createKeyed, LinkHandler, MenuItem, SettingsPage, Style, type Plugin } from "@opencode/plugin/gui"
import { BuiltinAppLink, builtinContext, BuiltinCommand, BuiltinPanel, BuiltinPromptGate, onIdle, type BuiltinPanelTab } from "@opencode/plugin/gui/builtin"
import { Browser, type ExperimentalBrowserTab } from "@opencode/plugin/gui/browser"
import type definition from "./index"
import type { Model } from "./model"
import { uuid } from "@opencode/util/uuid"
import {
  BROWSER_MODEL_LOAD_TIMEOUT_MS,
  createBrowserModelState,
  isLoadingBrowserModel,
  selectBrowserModel,
  selectBrowserModelError,
  selectBrowserTabHidden,
  transitionBrowserModel,
  type BrowserModelEvent,
} from "./model-machine"
import { PageIcon } from "./page-icon"
import { savedTab, tabIcon, tabTitle } from "./saved-tabs"
import { artifactLink, artifactWebURL } from "./artifact-link"
import { attachable } from "./prompt-gate"
import { remotePath, workspacePrefix } from "./remote-address"
import { viewportToolbarAvailable } from "./viewport-toolbar-machine"
import barStyles from "./bar.css?inline"
import commentStyles from "./comment.css?inline"
import tabStyles from "./tabs.css?inline"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const sessions = ctx.sessions
  const [modelState, setModelState] = createSignal(createBrowserModelState<Model>())
  const model = () => selectBrowserModel(modelState())
  const mac = /(Mac|iPhone|iPad)/.test(navigator.platform)
  // Settings > Shortcuts lists the command on every platform; it stays disabled until the pane can open. Bound like
  // Review's and Open file's launchers, since the sidebar owns mod+shift+b and mod+t opens a tab inside the pane.
  ctx.add(Command, (): Command | undefined => {
    const view = sessions.current()

    if (!view) return undefined
    const value = model()

    return {
      id: "open",
      title: ctx.t("command.open"),
      group: ctx.t("command.category.view"),
      bind: mac ? "ctrl+meta+b" : "ctrl+alt+b",
      editable: true,
      enabled: !!value?.available(view),
      run: () => value?.open(view),
    }
  })

  // Artifacts have a relative API link, not a workspace path. An external provider's ordinary web URL falls through.
  ctx.add(LinkHandler, {
    priority: 6,
    match: (link) => link.origin === undefined && !!link.session && !!artifactLink(link.href, link.session.server.url),
    open(link) {
      const session = link.session
      const url = session && artifactLink(link.href, session.server.url)

      if (session && url) {
        if (ctx.app.platform !== "desktop") {
          const external = artifactWebURL(url, session.server.url)

          if (external) return ctx.system.openExternal(external)
        }

        const pane = model()

        if (pane?.available(session)) return pane.openURL(session, url)
      }

      ctx.toast.show({ variant: "error", title: ctx.t("artifact.unavailable") })
    },
  })

  // The native pane is a desktop feature.
  if (ctx.app.platform !== "desktop") return
  ctx.add(BuiltinAppLink, {
    review(href) {
      const session = sessions.current()
      const result = session && model()?.reviewLink(session, href)

      if (!result) return ctx.toast.show({ title: ctx.t("link.unavailable") })
      void result.catch(() => {
        if (!ctx.signal.aborted) ctx.toast.show({ title: ctx.t("link.failed") })
      })
    },
  })
  ctx.add(LinkHandler, {
    priority: 6,
    match: (link) => link.origin === undefined && link.href.startsWith("workspace://"),
    open(link) {
      const session = link.session
      const pane = model()

      if (session?.id && !session.server.builtin && remotePath(link.href, workspacePrefix(session.id)) && pane?.available(session))
        return pane.openURL(session, link.href)
      ctx.toast.show({ variant: "error", title: ctx.t("refused.workspace") })
    },
  })
  // Tab trigger styles render with the strip, before the pane chunk loads.
  ctx.add(Style, tabStyles)
  ctx.add(Style, commentStyles)
  ctx.add(Style, barStyles)
  // Everything here serves a session, so the attachment model and the pane's protocol schemas load once the app
  // idles after startup, or when the first session opens if that is sooner.
  const owner = getOwner()
  // Each load in flight by attempt, for a caller that needs the model before its chunk arrived.
  const loads = new Map<number, Promise<void>>()

  const dispatchModel = (event: BrowserModelEvent<Model>) => {
    const next = transitionBrowserModel(untrack(modelState), event)

    if (next.state !== untrack(modelState)) setModelState(() => next.state)
    next.effects.forEach((effect) => loadModel(effect.attempt))
  }

  // A chunk that fails or never loads, such as after an update replaced the app's files, ends in `failed`.
  const loadModel = (attempt: number) => {
    const deadline = Promise.withResolvers<never>()
    const timer = setTimeout(() => deadline.reject(new Error(ctx.t("model.timedOut"))), BROWSER_MODEL_LOAD_TIMEOUT_MS)

    loads.set(
      attempt,
      Promise.race([import("./model"), deadline.promise])
        .finally(() => clearTimeout(timer))
        .then(
          (module) => {
            if (ctx.signal.aborted || !isLoadingBrowserModel(untrack(modelState), attempt)) return
            const created = runWithOwner(owner, () => module.createModel(ctx))!

            dispatchModel({ type: "load.succeeded", attempt, model: created })
          },
          (cause: unknown) =>
            dispatchModel({
              type: "load.failed",
              attempt,
              error: cause instanceof Error ? cause.message : String(cause),
            }),
        )
        .finally(() => loads.delete(attempt)),
    )
  }

  onCleanup(() => dispatchModel({ type: "disposed" }))

  // A strip tab drawn from the saved state can be closed or selected while the model's chunk still loads: the model
  // takes that once it is there. A load that fails takes nothing, and the panel says so.
  const withModel = (run: (value: Model) => void) => {
    const loaded = untrack(model)

    if (loaded) return run(loaded)
    dispatchModel({ type: "load.requested" })
    const loading = untrack(modelState)

    if (loading.status !== "loading") return
    void loads.get(loading.attempt)?.then(() => {
      const value = untrack(model)

      if (value && !ctx.signal.aborted) run(value)
    })
  }

  const opened = createMemo((seen: boolean) => seen || !!sessions.current(), false)
  createKeyed(opened, () => dispatchModel({ type: "load.requested" }))
  // A draft has no session until its first prompt is sent, and that prompt must not wait for a chunk to compile.
  onCleanup(onIdle(() => dispatchModel({ type: "load.requested" })))
  // The agent's first step lists the browser tools only when this desktop attached to the session before the prompt
  // reached the server. A draft's session is created by the send itself, so the send waits here for the attachment.
  ctx.add(BuiltinPromptGate, {
    ready(input) {
      // A prompt that cannot gain from an attachment waits for nothing, not even for the model's chunk.
      if (!attachable(input.session, navigator.onLine)) return
      dispatchModel({ type: "load.requested" })
      const loading = untrack(modelState)
      const loaded = loading.status === "loading" ? loads.get(loading.attempt) : undefined

      if (!loaded) return untrack(model)?.ready(input.session, input.signal)

      return loaded.then(() => {
        if (!input.signal.aborted && !ctx.signal.aborted) return untrack(model)?.ready(input.session, input.signal)
      })
    },
  })

  builtinContext(ctx).provideFor(Browser, (_consumer, signal) => {
    const owner = uuid()
    const targets = new Map<ExperimentalBrowserTab, string>()

    const experimental: Browser["experimental"] = {
      async open(session, url) {
        signal.throwIfAborted()
        ctx.signal.throwIfAborted()
        // A plugin may ask as its session first mounts, while the model's chunk still loads.
        dispatchModel({ type: "load.requested" })
        const loading = untrack(modelState)

        if (loading.status === "loading") await loads.get(loading.attempt)
        signal.throwIfAborted()
        ctx.signal.throwIfAborted()
        const pane = untrack(model)

        if (!pane) throw new Error("browser.pane.unavailable")

        const id = await pane.createTab(session.key, owner, url)
        signal.throwIfAborted()
        ctx.signal.throwIfAborted()
        targets.set(id, session.key)

        return id
      },
      async close(id) {
        const session = targets.get(id)

        if (!session || signal.aborted || ctx.signal.aborted) return false
        const closed = await model()?.closeOwned(session, owner, id) ?? false

        if (closed) targets.delete(id)

        return closed
      },
    }

    return {
      attached: (session) => model()?.attached(session) ?? false,
      canOpen: (session, path) => model()?.canOpen(session, path) ?? false,
      open: (session, url) => model()?.openURL(session, url),
      experimental,
      openFile: (session, path) => model()?.openFile(session, path),
    }
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
      run: () => pane.reload(),
    }
  })

  // The system browser's reload shortcut. While the page has focus, the page claims it itself; here it covers focus
  // elsewhere in the pane. Everywhere else mod+r keeps the window's Reload.
  ctx.add(Command, (): Command | undefined => {
    const pane = model()?.pane()

    if (!pane) return undefined

    return {
      id: "reloadPage",
      title: ctx.t("command.reload"),
      group: ctx.t("command.category.view"),
      bind: "mod+r",
      scope: "#browser-panel",
      hidden: true,
      editable: true,
      enabled: pane.visible(),
      run: () => pane.reload(),
    }
  })

  ctx.add(Command, (): Command | undefined => {
    const pane = model()?.pane()

    if (!pane) return

    return {
      id: "hardReload",
      title: ctx.t("menu.hardReload"),
      // The names developers know it by, which the palette matches.
      keywords: "hard reload ignore cache refresh",
      group: ctx.t("command.category.view"),
      bind: mac ? "mod+alt+r" : "ctrl+f5",
      scope: "#browser-panel",
      editable: true,
      enabled: pane.visible() && !!pane.address(),
      run: () => pane.reload(true),
    }
  })

  ctx.add(Command, (): Command | undefined => {
    const pane = model()?.pane()

    if (!pane) return undefined

    return {
      id: "find",
      title: ctx.t("find.open"),
      group: ctx.t("command.category.view"),
      bind: "mod+f",
      scope: "#browser-panel",
      editable: true,
      enabled: pane.visible() && pane.inspectable(),
      run: pane.find,
    }
  })

  for (const direction of ["next", "previous"] as const) {
    const shift = direction === "previous" ? "shift+" : ""
    ctx.add(Command, (): Command | undefined => {
      const pane = model()?.pane()

      if (!pane) return

      return {
        id: `find.${direction}`, title: ctx.t(`find.${direction}`), group: ctx.t("command.category.view"),
        bind: mac ? `mod+${shift}g` : `mod+${shift}g,${shift}f3`, scope: "#browser-panel", editable: true,
        enabled: pane.visible() && pane.inspectable(), run: () => pane.findMatch(direction),
      }
    })
  }

  // The system browser's address shortcut, in the pane and, forwarded like mod+t and mod+w, from a page with focus.
  // Ctrl+L focuses the composer outside the pane on Windows and Linux.
  ctx.add(Command, (): Command | undefined => {
    const pane = model()?.pane()

    if (!pane) return undefined

    return {
      id: "address",
      title: ctx.t("command.address"),
      group: ctx.t("command.category.view"),
      bind: "mod+l",
      scope: "#browser-panel",
      editable: true,
      enabled: pane.visible(),
      run: pane.focusAddress,
    }
  })

  ctx.add(Command, (): Command | undefined => {
    const pane = model()?.pane()

    if (!pane || !viewportToolbarAvailable(ctx.app.channel)) return undefined

    return {
      id: "toggleToolbar",
      title: ctx.t("command.toggleToolbar"),
      group: ctx.t("command.category.view"),
      bind: "mod+shift+m",
      // Browser menus and popovers take keyboard focus in a portal outside the panel.
      scope: "#browser-panel, [data-browser-popup]",
      enabled: pane.visible() && pane.inspectable(),
      run: pane.toggleToolbar,
    }
  })

  // Blank pages have no focused native view, so the app must claim close inside the pane too.
  ctx.add(BuiltinCommand, (): BuiltinCommand | undefined => {
    const pane = model()?.pane()

    if (!pane) return undefined

    return {
      id: "close",
      title: ctx.t("command.close"),
      group: ctx.t("command.category.view"),
      bind: "mod+w",
      follows: "tab.close",
      scope: "#browser-panel",
      hidden: true,
      editable: true,
      enabled: pane.visible(),
      run: pane.close,
    }
  })

  // As in a browser, mod+t opens a tab inside the pane; everywhere else it keeps the app's new session.
  ctx.add(Command, (): Command | undefined => {
    const view = sessions.current()
    const value = model()
    const pane = value?.pane()

    if (!view || !value || !pane) return undefined

    return {
      id: "newTab",
      title: ctx.t("command.newTab"),
      group: ctx.t("command.category.view"),
      bind: "mod+t",
      scope: "#browser-panel",
      hidden: true,
      editable: true,
      enabled: pane.visible() && value.available(view),
      run: () => value.open(view),
    }
  })

  // Chromium's element picker chord. While the page has focus, the page claims it itself; here it covers focus elsewhere
  // in the pane. Ctrl+Shift+C copies in the terminal outside the pane.
  ctx.add(Command, (): Command | undefined => {
    const pane = model()?.pane()

    if (!pane) return undefined

    return {
      id: "inspect",
      title: ctx.t("command.inspect"),
      group: ctx.t("command.category.view"),
      bind: "mod+shift+c",
      scope: "#browser-panel",
      editable: true,
      enabled: pane.visible() && pane.inspectable(),
      run: pane.inspect,
    }
  })

  ctx.add(MenuItem, (): MenuItem | undefined => {
    const view = sessions.current()
    const value = model()

    // Only once the desktop's pane answers.
    if (!view || !value?.available(view) || !value.attached(view)) return undefined

    // A launcher of the side panel's new tab view, between Review and Terminal.
    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("tab.title"),
      icon: "globe",
      keybind: "browser.open",
      order: 15,
      run: () => value.open(view),
    }
  })

  // Workspace HTML links reach the pane through the file plugin, which resolves the path first.
  // A composer chip for a comment on a picked element.
  ctx.add(LinkHandler, {
    priority: 10,
    match: (link) => link.origin === ctx.id && !!link.session,
    open(link) {
      if (link.session) model()?.reveal(link.session, link.href)
    },
  })

  // A web link the user clicked in a session opens beside it, in the profile where they are signed in. While the pane
  // cannot open it, or the user turned this off, the link goes on to the system browser.
  ctx.add(LinkHandler, {
    priority: 5,
    match: (link) =>
      link.origin === undefined &&
      /^https?:\/\//i.test(link.href) &&
      ctx.stores.preferences.value.links &&
      !!link.session &&
      !!model()?.available(link.session),
    open(link) {
      if (link.session) model()?.openURL(link.session, link.href)
    },
  })

  const SettingsView = lazy(() => import("./settings"))

  ctx.add(SettingsPage, {
    id: "browser",
    icon: "globe",
    get title() {
      return ctx.t("settings.title")
    },
    get entries() {
      return [
        { id: "settings-browser-links", title: ctx.t("settings.links.title"), keywords: "links open system browser" },
        { id: "settings-browser-agent-pages", title: ctx.t("settings.agentPages.title"), keywords: "agent preview automatic browser pane" },
        {
          id: "settings-browser-remote",
          title: ctx.t("settings.remote.title"),
          keywords: "remote server sign in cookies share",
        },
        { id: "settings-browser-cookies", title: ctx.t("settings.cookies.title"), keywords: "cookies sign out history clear" },
        {
          id: "settings-browser-import",
          title: ctx.t("settings.import.title"),
          keywords: "import cookies history chrome edge firefox safari helium arc brave sign in",
        },
        { id: "settings-browser-extensions", title: ctx.t("settings.extensions.title"), keywords: "extensions" },
        {
          id: "settings-browser-sites",
          title: ctx.t("settings.sites.title"),
          keywords: "site permissions camera microphone location notifications clipboard",
        },
      ]
    },
    // A search that lands on a row inside Advanced opens it; the page reads the entry being revealed.
    render: (input) => (
      <Suspense>
        <SettingsView target={input.target} />
      </Suspense>
    ),
  })

  // Stable tab objects with live labels, so title and URL changes never remount a trigger.
  const tabs = new Map<string, Map<string, BuiltinPanelTab>>()

  const create = (session: string, id: string): BuiltinPanelTab => {
    // The tab's page as the last run left it. The strip draws it until the desktop reports the tab again, and keeps
    // its title and icon until the tab's page has its own, so the label never changes while a restored page loads.
    const saved = () => savedTab(ctx.stores.tabs.value, session, id)
    const page = () => model()?.tab({ key: session }, id) ?? saved()

    const text = () => {
      const tab = page()

      return !tab?.url || tab.url === "about:blank" ? ctx.t("tab.new") : tabTitle(tab, saved()) || tab.url
    }

    const icon = () => {
      const tab = page()

      return tab && tabIcon(tab, model()?.page({ key: session }, id)?.icon, saved())
    }

    return {
      id,
      get title() {
        return text()
      },
      label: () => (
        <div class="flex items-center gap-1.5">
          <PageIcon icon={icon()} />
          <span class="max-w-40 truncate">{text()}</span>
          <Show when={model()?.asking({ key: session }, id) ? "prompt.tab" : model()?.unseen({ key: session }, id) && "tab.activity"}>
            {(status) => <span role="img" aria-label={ctx.t(status())} class="size-1.5 shrink-0 rounded-full" classList={{ "bg-v2-state-fg-warning": status() === "prompt.tab", "bg-v2-state-fg-info": status() === "tab.activity" }} />}
          </Show>
        </div>
      ),
      // A tab the last run saved draws at once. Any other is listed only to hold the restored selection until the
      // desktop's first inventory names it, or the model failed to load and the panel says so.
      get hidden() {
        return selectBrowserTabHidden(modelState(), (value) => !!value.tab({ key: session }, id), !!saved())
      },
      group: "browser",
      dom: { tab: `session-side-panel-browser-tab-${id}`, panel: "session-side-panel-browser-tabpanel" },
    }
  }

  // What a tab's panel shows while its content cannot be known yet: the model's chunk loads, or the desktop has not
  // reported the session's tabs.
  const Waiting = () => (
    <div
      role="status"
      aria-label={ctx.t("common.loading")}
      class="size-full flex items-center justify-center text-v2-icon-icon-muted"
    >
      <Loader class="size-4" />
    </div>
  )

  // The browser could not open: its model failed to load (`detail` says why), or the session's server has no browser
  // or keeps refusing the pane. The strip keeps the tab, which can still be closed.
  const Failed = (props: { detail?: string; retry: () => void }) => (
    <div role="alert" class="size-full flex flex-col items-center justify-center gap-3 px-4 text-center">
      <div class="flex flex-col gap-1">
        <div class="text-13-regular text-text-strong">{ctx.t("model.failed")}</div>
        <Show when={props.detail}>
          <div class="text-12-regular text-text-weak break-words">{props.detail}</div>
        </Show>
      </div>
      <Button size="small" variant="outline" onClick={() => props.retry()}>
        {ctx.t("common.retry")}
      </Button>
    </div>
  )

  const SessionBrowserPane = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void SessionBrowserPane.preload()))
  ctx.add(BuiltinPanel, {
    id: "main",
    region: "side",
    list(input) {
      // While the model loads, the stored tabs hold the strip and its selection, as before the first inventory.
      const ids = model()?.tabs(input.session, input.open) ?? input.open

      if (ids.length === 0) {
        tabs.delete(input.session.key)

        return []
      }

      const previous = tabs.get(input.session.key)
      const next = new Map(ids.map((id) => [id, previous?.get(id) ?? create(input.session.key, id)]))
      tabs.set(input.session.key, next)

      return [...next.values()]
    },
    // Until the desktop's first inventory names its tabs, the pane has no page to show: the tab's content loads, or
    // says that the browser could not open. Every wait ends in the pane or in that.
    render: (props) => (
      <Switch fallback={<Waiting />}>
        <Match when={model()}>
          {(value) => (
            <Switch
              fallback={
                <Suspense>
                  <SessionBrowserPane
                    tab={() => props.tab}
                    session={props.session}
                    screen={props.screen}
                    model={value()}
                  />
                </Suspense>
              }
            >
              <Match when={value().pending(props.session)}>
                <Waiting />
              </Match>
              <Match when={value().unavailable(props.session)}>
                <Failed retry={() => value().retry(props.session)} />
              </Match>
            </Switch>
          )}
        </Match>
        <Match when={selectBrowserModelError(modelState())}>
          {(error) => <Failed detail={error()} retry={() => dispatchModel({ type: "retry.requested" })} />}
        </Match>
      </Switch>
    ),
    close(input) {
      const session = input.session
      const id = input.tab.id

      withModel((value) => value.closeTab(session, id))
    },
    // A blank new tab does not come back; a page comes back as a new tab on its address.
    closed(input) {
      const url = (
        model()?.tab(input.session, input.tab.id) ?? savedTab(ctx.stores.tabs.value, input.session.key, input.tab.id)
      )?.url

      if (!url || url === "about:blank") return false

      return { icon: "globe", detail: URL.canParse(url) ? new URL(url).host : undefined, data: url }
    },
    restore: (input) => {
      if (input.data) model()?.openURL(input.session, input.data)
    },
    focus(input) {
      const session = input.session
      const id = input.tab.id
      const restored = input.restored

      withModel((value) => value.focusTab(session, id, restored))
    },
    // A blank tab starts in its address field, like a browser's new tab.
    enter: () => {
      const pane = model()?.pane()

      if (pane?.visible() && !pane.address()) pane.focusAddress()
    },
  })
}

export default setup
