import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  on,
  onCleanup,
  runWithOwner,
  untrack,
  useContext,
  type Accessor,
  type Owner,
} from "solid-js"
import { createStore, produce, type Store } from "solid-js/store"
import { Predicate } from "effect"
import { useDialog } from "@opencode/ui/context/dialog"
import { base64Encode } from "@opencode/util/encode"
import {
  App,
  Layout,
  Native,
  Panel,
  Preferences,
  Sessions,
  Storage,
  Surfaces,
  System,
  type Host,
  type PanelState,
  type ServerRef,
  type SessionRef,
  type SessionView,
  type StorageScope,
} from "@opencode/gui-extensions/sdk"
import { usePlatform } from "@/runtime/platform/platform"
import { same } from "@/runtime/persistence/equality"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { SessionRouteKey, SessionStateKey, type ServerScope } from "@/runtime/server/scope"
import { findSessionTab, tabKey, useTabs } from "@/shell/tabs/tabs"
import { useCurrentRoute, useLayout } from "@/shell/state/layout"
import { terminalFontFamily, useSettings } from "@/settings/model"
import { useSettingsSurface } from "@/settings/surface"
import { formatKeybindParts, useCommand } from "@/shell/commands/command"
import { createMediaQuery } from "@solid-primitives/media"
import { useIsRouting, useLocation } from "@solidjs/router"
import { useLanguage } from "@/runtime/i18n/language"
import { useExtensionHost } from "./host"
import type { Region } from "./panels"
import { createSurfaces } from "./surface"

type Attached = {
  sessions: Accessor<readonly SessionRef[]>
  current: Accessor<SessionView | undefined>
  scope: (server: string) => ServerScope
  /** Records a session-scoped store so layout pruning drops it with the session. */
  scoped: (name: string) => void
  layout: Omit<Layout, "narrow" | "settings" | "project" | "stored"> & {
    stored(extension: string, session: SessionRef): readonly string[]
  }
  settings: (page?: string) => void
  project: (server: string, title: string) => void
  font: Accessor<string>
  preferences: Preferences
  routing: Accessor<boolean>
  path: Accessor<string>
  keybind: (command: string) => readonly string[]
  matches: (command: string, event: KeyboardEvent) => boolean
  servers: Accessor<readonly string[]>
}

export type HostService = { readonly token: Host<unknown>; create(extension: string, owner: Owner | null): unknown }
type StorageFrom = Parameters<Storage["store"]>[1]["from"]

/** Services the host owns. Session and layout attach once the app interface mounts. */
export function createExtensionServices() {
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const narrow = createMediaQuery("(max-width: 767px)")
  const [attached, setAttached] = createSignal<Attached>()
  const removed = new Set<(value: { server: string; directory: string }) => void>()
  const memory = new Map<string, readonly [Store<object>, (mutation: (draft: object) => void) => void]>()
  const current = () => attached()
  const surfaces = createSurfaces({
    bridge: platform.extensions,
    zoom: () => platform.webviewZoom?.() ?? 1,
    dialog: () => !!dialog.active,
  })

  const target = (extension: string, key: string, scope: StorageScope | undefined, from: StorageFrom | undefined) => {
    const name = `extension.${extension}.${key}`
    const copyFrom = typeof from === "string" ? { key: from } : from
    if (!scope || scope === "app") return { ...Persist.global(name), copyFrom }
    const connected = requireAttached(attached())
    if ("session" in scope) {
      const location = scope.session.location
      if (!location) throw new Error("Session storage requires a session location")
      connected.scoped(name)
      const server = connected.scope(scope.session.server.id)
      const directory = base64Encode(location.directory)
      return {
        ...Persist.serverSession(server, directory, scope.session.id, name),
        copyFrom:
          sessionCopy(from, SessionStateKey.from(server, SessionRouteKey.fromRoute(directory, scope.session.id))) ??
          copyFrom,
      }
    }
    if (!scope.directory) return { ...Persist.serverGlobal(connected.scope(scope.server), name), copyFrom }
    return { ...Persist.serverWorkspace(connected.scope(scope.server), base64Encode(scope.directory), name), copyFrom }
  }

  const services: HostService[] = [
    {
      token: Storage,
      create: (extension, owner) =>
        ({
          store(key, options) {
            // Persistence owns effects and resources; code after an await in setup has no owner.
            const pair = runWithOwner(getOwner() ?? owner, () =>
              persisted(target(extension, key, options.scope, options.from), options.schema, options.initial, platform),
            )!
            return [pair[0], (mutation: (draft: object) => void) => pair[1](produce(mutation)), pair[3]] as never
          },
          memory(key, options) {
            const name = `${extension}.${key}`
            const existing = memory.get(name)
            if (existing) return existing as never
            const [store, setStore] = createStore<object>(options.initial)
            const value = [store, (mutation: (draft: object) => void) => setStore(produce(mutation))] as const
            memory.set(name, value)
            return value as never
          },
          remove(key, options) {
            removePersisted(target(extension, key, options?.scope, undefined), platform)
          },
        }) satisfies Storage,
    },
    {
      token: System,
      create: () =>
        ({
          copy: (text) => platform.writeClipboardText?.(text) ?? navigator.clipboard.writeText(text),
          async save(file) {
            if (platform.saveFile) return platform.saveFile({ defaultPath: file.name }, file.content)
            const url = URL.createObjectURL(new Blob([file.content], { type: "application/octet-stream" }))
            const link = document.createElement("a")
            link.href = url
            link.download = file.name
            link.click()
            URL.revokeObjectURL(url)
            return true
          },
          open(url) {
            if (platform.openLocalFile && URL.canParse(url) && new URL(url).protocol === "file:")
              return platform.openLocalFile(url)
            platform.openExternal(url)
          },
        }) satisfies System,
    },
    {
      token: Native,
      create: () =>
        platform.platform === "desktop"
          ? ({
              os: platform.os ?? "linux",
              window: platform.windowID,
              zoom: () => platform.webviewZoom?.() ?? 1,
              launch: (path, app) => platform.openPath?.(path, app) ?? Promise.resolve(),
              reveal: (path) => platform.revealPath?.(path) ?? Promise.resolve(false),
              installed: (app) => platform.checkAppExists?.(app) ?? Promise.resolve(false),
              forceFocus: (enabled) => platform.setForceFocus?.(enabled) ?? Promise.resolve(),
            } satisfies NonNullable<Native>)
          : undefined,
    },
    {
      token: App,
      create: () =>
        ({
          version: platform.version,
          channel: (import.meta.env.VITE_OPENCODE_CHANNEL ?? "local") as App["channel"],
          platform: platform.platform,
          font: () => requireAttached(current()).font(),
          locale: language.intl,
          direction: language.direction,
          setDirection: language.setDirection,
          routing: () => current()?.routing() ?? false,
          path: () => current()?.path() ?? "",
          keybind: (command) => current()?.keybind(command) ?? [],
          keys: (bind) => formatKeybindParts(bind, language.t),
          matches: (command, event) => current()?.matches(command, event) ?? false,
          servers: () => current()?.servers() ?? [],
          on(_event, handler) {
            removed.add(handler)
            return () => {
              removed.delete(handler)
            }
          },
        }) satisfies App,
    },
    {
      token: Sessions,
      create: () =>
        ({
          list: () => current()?.sessions() ?? [],
          current: () => current()?.current(),
        }) satisfies Sessions,
    },
    {
      token: Layout,
      create: (extension) =>
        ({
          narrow,
          ready: () => current()?.layout.ready() ?? false,
          open: (key, session, options) => requireAttached(current()).layout.open(key, session, options),
          close: (key, session) => requireAttached(current()).layout.close(key, session),
          toggle: (key, session) => requireAttached(current()).layout.toggle(key, session),
          state: (key, session) => requireAttached(current()).layout.state(key, session),
          stored: (session) => requireAttached(current()).layout.stored(extension, session),
          side: {
            opened: (session) => requireAttached(current()).layout.side.opened(session),
            toggle: (session) => requireAttached(current()).layout.side.toggle(session),
          },
          dock: {
            opened: (session) => requireAttached(current()).layout.dock.opened(session),
            placement: () => requireAttached(current()).layout.dock.placement(),
          },
          scroll: {
            get: (session, key) => requireAttached(current()).layout.scroll.get(session, key),
            set: (session, key, value) => requireAttached(current()).layout.scroll.set(session, key, value),
          },
          settings: (page) => requireAttached(current()).settings(page),
          project: (server, title) => requireAttached(current()).project(server, title),
        }) satisfies Layout,
    },
    {
      token: Preferences,
      create: () =>
        ({
          releaseNotes: () => requireAttached(current()).preferences.releaseNotes(),
          setReleaseNotes: (value) => requireAttached(current()).preferences.setReleaseNotes(value),
          mobileDiffWrap: () => requireAttached(current()).preferences.mobileDiffWrap(),
        }) satisfies Preferences,
    },
    { token: Surfaces, create: () => surfaces },
  ]

  return {
    services,
    attach(value: Attached) {
      setAttached(() => value)
      return () => {
        if (attached() === value) setAttached(undefined)
      }
    },
    workspaceRemoved(value: { server: string; directory: string }) {
      removed.forEach((handler) => handler(value))
    },
  }
}

export type ExtensionServices = ReturnType<typeof createExtensionServices>

const AttachmentContext = createContext<ReturnType<typeof createExtensionAttachment>>()

export function useExtensionAttachment() {
  const value = useContext(AttachmentContext)
  if (!value) throw new Error("Extension attachment is unavailable")
  return value
}

export const ExtensionAttachmentProvider = AttachmentContext.Provider

/** Attaches session and layout services from inside the app interface. */
export function createExtensionAttachment(services: ExtensionServices) {
  const global = useGlobal()
  const tabs = useTabs()
  const layout = useLayout()
  const route = useCurrentRoute()
  const settings = useSettings()
  const surface = useSettingsSurface()
  const host = useExtensionHost()
  const command = useCommand()
  const location = useLocation()
  const narrow = createMediaQuery("(max-width: 767px)")
  const views = new Map<string, SessionView>()
  const [mounted, setMounted] = createStore({ revision: 0 })
  const refs = new Map<string, SessionRef>()
  // The panel whose toggle opened a session's side region, by session key.
  const openedFor = new Map<string, string>()

  const connection = (id: string) => global.servers.list().find((item) => ServerConnection.key(item) === id)

  // One ref per server id. A restarted server (e.g. an updated WSL server) gets a new controller under the same id,
  // so the ref follows the live controller instead of the one it was created with.
  const owner = getOwner()
  const serverRefs = new Map<string, ServerRef>()
  const server = (id: string): ServerRef | undefined => {
    const conn = connection(id)
    if (!conn) return
    const existing = serverRefs.get(id)
    if (existing) return existing
    const key = ServerConnection.Key.make(id)
    const live = runWithOwner(owner, () =>
      createMemo<ServerCtx>((previous) => global.serverCtx(key) ?? previous, global.ensureServerCtx(conn)),
    )!
    const ref: ServerRef = {
      id,
      get name() {
        return serverName(live().sdk.server) || id
      },
      get url() {
        return live().sdk.url
      },
      get password() {
        return live().sdk.server.http.password
      },
      get client() {
        return live().sdk.api
      },
      get data() {
        return live().data
      },
      get local() {
        return ServerConnection.local(live().sdk.server)
      },
      get builtin() {
        return ServerConnection.builtin(live().sdk.server)
      },
      get compatible() {
        return !global.servers.health[key]?.incompatible
      },
      get connected() {
        return live().sdk.connection.status() === "connected"
      },
    }
    serverRefs.set(id, ref)
    return ref
  }

  const sessions = createMemo(() => {
    const owned = new Set(tabs.store.filter((tab) => tab.type === "session").map(tabKey))
    Array.from(refs).forEach(([key, ref]) => {
      if (!owned.has(ref.tab)) refs.delete(key)
    })
    tabs.store.forEach((tab) => {
      if (tab.type !== "session") return
      const target = server(tab.server)
      if (!target) return
      Array.from(new Set([tab.sessionId, tab.routeSessionId ?? tab.sessionId])).forEach((id) => {
        const key = `${tab.server}\n${id}`
        if (refs.has(key)) return
        refs.set(key, {
          key,
          id,
          tab: tabKey(tab),
          server: target,
          get pending() {
            return target.data.session.creating(id)
          },
          get location() {
            return target.data.session.get(id)?.location
          },
        })
      })
    })
    return Array.from(refs.values())
  })

  const current = createMemo(() => {
    const value = route()
    if (value.type !== "session") return
    void mounted.revision
    return views.get(`${value.server}\n${value.sessionId}`)
  })

  const scope = (id: string) => {
    const conn = connection(id)
    if (!conn) throw new Error(`Server ${id} is unavailable`)
    return global.ensureServerCtx(conn).sdk.scope
  }

  const stateKey = (session: SessionRef) => {
    const location = session.location
    if (!location) return
    return SessionStateKey.from(
      scope(session.server.id),
      SessionRouteKey.fromRoute(base64Encode(location.directory), session.id),
    )
  }

  const shellTab = (session: SessionRef) =>
    findSessionTab(tabs.store, ServerConnection.Key.make(session.server.id), session.id)
  const sideOpened = (session: SessionRef) => !!tabs.pane(shellTab(session), "side")
  const dockOpened = (session: SessionRef) => !!tabs.pane(shellTab(session), "dock")
  const setDock = (session: SessionRef, opened: boolean) => tabs.setPane(shellTab(session), "dock", opened)
  // However the side region closes, it forgets its opener, so a region reopened any other way belongs to the user.
  createEffect(() => {
    const open = new Set(sessions().flatMap((session) => (sideOpened(session) ? [session.key] : [])))
    Array.from(openedFor.keys()).forEach((key) => {
      if (!open.has(key)) openedFor.delete(key)
    })
  })

  // Keys are `${extension}:${tab id}`; the extension's panel decides the region.
  const provider = (key: string) => {
    const extension = key.slice(0, key.indexOf(":"))
    const matches = host.items(Panel).filter((item) => item.extension === extension)
    return matches.find((item) => item.value.region === "side") ?? matches[0]
  }
  const mountedView = (session: SessionRef) => {
    const view = current()
    return view?.key === session.key ? view : undefined
  }

  // The narrow-screen view belongs to the routed, mounted session: it resets to the conversation when that session
  // changes or unmounts (e.g. on Home). The dock's view follows the dock's own per-session state instead.
  const [mobile, setMobile] = createStore({ session: undefined as string | undefined, view: "session" })
  createEffect(
    on(
      () => current()?.key,
      (key) => {
        if (key !== mobile.session) setMobile({ session: undefined, view: "session" })
      },
    ),
  )
  const mobileView = createMemo(() => (mobile.session === current()?.key ? mobile.view : "session"))
  const selectMobile = (session: SessionRef, view: string) => setMobile({ session: session.key, view })

  // The side tabs a mounted session lists right now, plus `adding` as if it were stored; unmounted sessions have none.
  const listed = (session: SessionRef, value: string, adding?: string) => {
    const view = mountedView(session)
    if (!view) return []
    const all = layout.panel.state(value).all
    const stored = adding && !all.includes(adding) ? [...all, adding] : all
    return untrack(() =>
      host
        .items(Panel)
        .filter((item) => item.value.region === "side")
        .flatMap((item) => {
          const prefix = `${item.extension}:`
          const open = stored.flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))
          return item.value.list(view, open).map((tab) => ({ key: `${prefix}${tab.id}`, tab }))
        }),
    )
  }

  const open = (
    key: string,
    session: SessionRef,
    options?: { readonly preview?: boolean; readonly focus?: boolean; readonly select?: boolean },
  ) => {
    const item = provider(key)
    if (item?.value.region === "dock") return setDock(session, true)
    const value = stateKey(session)
    if (!value) return
    // focus: false adds the tab quietly: no selection, no region change, no preview replacement.
    if (options?.focus === false && !options.preview) return layout.panel.append(value, key)
    if (options?.select)
      return batch(() => {
        if (!narrow()) tabs.setPane(shellTab(session), "side", true)
        layout.panel.append(value, key)
        layout.panel.focus(value, key)
      })
    // Lists the opened tab too, so its own fields apply before it is stored.
    const known = listed(session, value, key)
    const launchers = new Set(known.flatMap((entry) => (entry.tab.kind === "launcher" ? [entry.key] : [])))
    const first = known.some((entry) => entry.key === key && entry.tab.first)
    batch(() => {
      if (narrow()) {
        setDock(session, false)
        if (item?.value.mobile) selectMobile(session, `${item.extension}:${item.value.id}`)
        // A tab its panel does not list on narrow screens stays unstored: the open only selects the panel's view.
        if (mountedView(session) && !known.some((entry) => entry.key === key)) return
      }
      if (!narrow()) tabs.setPane(shellTab(session), "side", true)
      // Pinned tabs are listed without being stored; opening one only selects it.
      if (known.some((entry) => entry.key === key && entry.tab.kind === "pinned")) return layout.panel.focus(value, key)
      if (options?.preview) return layout.panel.preview(value, key, launchers)
      layout.panel.open(value, key, launchers, first)
    })
  }

  const close = (key: string, session: SessionRef) => {
    const item = provider(key)
    if (item?.value.region === "dock") return setDock(session, false)
    const value = stateKey(session)
    if (!value) return
    const tab = listed(session, value).find((entry) => entry.key === key)?.tab
    layout.panel.close(value, key)
    const view = mountedView(session)
    if (view && tab) item?.value.close?.(tab, view)
  }

  // The routed session's side region, which knows the fallback selection the stored state lacks.
  const [region, setRegion] = createSignal<Region>()
  const opened = createMemo(
    () => Array.from(new Set((region()?.entries() ?? []).flatMap((entry) => entry.tab.file ?? []))),
    [],
    { equals: same },
  )

  const state = (key: string, session: SessionRef): PanelState => {
    if (provider(key)?.value.region === "dock") return dockOpened(session) ? "visible" : "closed"
    const value = stateKey(session)
    if (!value) return "closed"
    const panel = layout.panel.state(value)
    const active = mountedView(session) ? (region()?.active() ?? panel.active) : panel.active
    if (active !== key) return panel.all.includes(key) ? "open" : "closed"
    return sideOpened(session) ? "visible" : "active"
  }

  // Open-project requests wait until their server is listed (e.g. an SSH server that just connected).
  const servers = useServers()
  const picker = useDirectoryPicker()
  const [projects, setProjects] = createSignal<readonly { server: string; title: string }[]>([])
  createEffect(() => {
    const pending = projects()
    const ready = pending.flatMap((request) => {
      const server = servers.list.find((conn) => ServerConnection.key(conn) === request.server)
      return server ? [{ request, server }] : []
    })
    if (ready.length === 0) return
    setProjects(pending.filter((request) => !ready.some((item) => item.request === request)))
    untrack(() =>
      ready.forEach(({ request, server }) =>
        picker({
          server,
          title: request.title,
          onSelect: (value) => {
            const directory = Array.isArray(value) ? value[0] : value
            if (!directory) return
            const key = ServerConnection.key(server)
            servers.projects.forServer(key).open(directory)
            void tabs.newDraft({ server: key, directory })
          },
        }),
      ),
    )
  })

  const detach = services.attach({
    sessions,
    current,
    scope,
    scoped: layout.sessionState.track,
    project: (server, title) => setProjects((pending) => [...pending, { server, title }]),
    font: () => terminalFontFamily(settings.appearance.terminalFont()),
    routing: useIsRouting(),
    path: () => `${location.pathname}${location.search}`,
    keybind: command.keybindParts,
    matches: command.matches,
    servers: () => global.servers.list().map(ServerConnection.key),
    preferences: {
      releaseNotes: settings.general.releaseNotes,
      setReleaseNotes: settings.general.setReleaseNotes,
      mobileDiffWrap: settings.general.mobileDiffWrap,
    },
    settings: (page) => surface.open(page as Parameters<typeof surface.open>[0]),
    layout: {
      ready: layout.ready,
      open,
      close,
      toggle(key, session) {
        if (provider(key)?.value.region === "dock") return setDock(session, !dockOpened(session))
        const value = stateKey(session)
        if (!value) return
        if (state(key, session) === "visible") {
          batch(() => {
            close(key, session)
            // Closing the last panel the region was opened for also closes the region.
            if (openedFor.get(session.key) === key && layout.panel.state(value).all.length === 0)
              tabs.setPane(shellTab(session), "side", false)
          })
          return
        }
        const opening = !sideOpened(session)
        if (!opening) openedFor.delete(session.key)
        open(key, session)
        if (opening && sideOpened(session)) openedFor.set(session.key, key)
      },
      state,
      stored(extension, session) {
        const value = stateKey(session)
        if (!value) return []
        const prefix = `${extension}:`
        return layout.panel
          .state(value)
          .all.flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))
      },
      side: {
        opened: sideOpened,
        toggle: (session) => tabs.setPane(shellTab(session), "side", !sideOpened(session)),
      },
      dock: {
        opened: dockOpened,
        placement: settings.general.terminalPlacement,
      },
      scroll: {
        get(session, key) {
          const value = stateKey(session)
          return value ? layout.panel.scroll(value, key) : undefined
        },
        set(session, key, next) {
          const value = stateKey(session)
          if (value) layout.panel.setScroll(value, key, next)
        },
      },
    },
  })
  onCleanup(detach)

  return {
    /** The routed, mounted session view. */
    current,
    region(value: Region) {
      setRegion(() => value)
      return () => {
        if (region() === value) setRegion(undefined)
      }
    },
    /** Workspace files the routed session's side tabs show, in strip order, and the selected one. */
    files: {
      opened,
      active: () => region()?.selected()?.tab.file,
    },
    mobile: {
      current: mobileView,
      select(view: string) {
        const session = current()
        if (session) selectMobile(session, view)
      },
    },
    mount(key: string, view: SessionView) {
      views.set(key, view)
      setMounted("revision", (value) => value + 1)
      return () => {
        if (views.get(key) !== view) return
        views.delete(key)
        setMounted("revision", (value) => value + 1)
      }
    },
  }
}

function requireAttached(value: Attached | undefined) {
  if (!value) throw new Error("The app interface is not mounted")
  return value
}

/** Imports a session's entry from an app key that holds every session's state under one field. */
function sessionCopy(from: StorageFrom, session: SessionStateKey) {
  if (typeof from !== "object" || !from.sessions) return
  const field = from.sessions
  return {
    key: from.key,
    storage: Persist.global(from.key).storage,
    pick: (value: unknown) => {
      const sessions = Predicate.isObject(value) ? value[field] : undefined
      return from.pick(Predicate.isObject(sessions) ? sessions[session] : undefined)
    },
  }
}
