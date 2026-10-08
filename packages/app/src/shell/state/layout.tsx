import { createStore, produce, reconcile } from "solid-js/store"
import { Predicate, Schema, SchemaGetter } from "effect"
import { batch, createEffect, createMemo, onCleanup, onMount, untrack, type Accessor } from "solid-js"
import { useLocation } from "@solidjs/router"
import { createSimpleContext } from "@opencode/ui/context"
import { makeEventListener } from "@solid-primitives/event-listener"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { usePlatform } from "@/runtime/platform/platform"
import type { Project } from "@/runtime/server/types"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { TabStorage } from "@/shell/tabs/schema"
import { createScrollPersistence, type SessionScroll } from "./scroll"
import { SessionStateKey } from "@/runtime/server/scope"
import { createSessionKeyReader, ensureSessionKey, pruneSessionKeys } from "./helpers"
import { requireServerKey } from "@/shell/routes/session"
import { closeSessionTab, openSessionTab, previewSessionTab } from "./session-tabs"

const DEFAULT_SIDEBAR_WIDTH = 344

const DEFAULT_FILE_TREE_WIDTH = 200

const DEFAULT_SESSION_WIDTH = 600

const DEFAULT_DOCK_HEIGHT = 280

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export type HomeProjectSelection = typeof layoutSchema.Type.home.selection

export type TabRegions = {
  dockOpened: Accessor<boolean>
  setDockOpened(opened: boolean): void
  dockHeight: Accessor<number | undefined>
  setDockHeight(height: number): void
  sideOpened: Accessor<boolean>
  setSideOpened(opened: boolean): void
  sessionWidth: Accessor<number | undefined>
  setSessionWidth(width: number): void
}

export type LayoutRoute =
  | { type: "home" }
  | { type: "settings" }
  | { type: "connect" }
  | { type: "draft"; draftID: string }
  | { type: "session"; sessionId: string; server: ServerConnection.Key }

export const currentRoute = (pathname: string, search: string): LayoutRoute => {
  const parts = pathname.split("/").filter(Boolean)

  if (parts.length === 0) return { type: "home" }

  if (parts[0] === "settings") return { type: "settings" }

  if (parts[0] === "connect") return { type: "connect" }

  if (parts[0] === "new-session") {
    const draftID = new URLSearchParams(search).get("draftId")

    if (!draftID) return { type: "home" }

    return { type: "draft", draftID }
  }

  if (parts[0] === "server" && parts[2] === "session" && parts[3]) {
    return {
      type: "session",
      sessionId: parts[3],
      server: requireServerKey(parts[1]),
    }
  }

  throw new Error("Unrecognised route!")
}

export const useCurrentRoute = () => {
  const location = useLocation()

  return createMemo(() => currentRoute(location.pathname, location.search))
}

const sessionTabsSchema = Persistence.struct({
  all: Persistence.array(Schema.String),
  active: Persistence.optional(Schema.String),
})

const sessionViewSchema = Persistence.struct({
  scroll: Persistence.record(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })),
  // Review state from before extensions. An extension copies each session's entry out once; nothing writes these
  // any more, and they stay so layout rewrites cannot drop a session's entry before it is copied.
  reviewOpen: Schema.optional(Persistence.array(Schema.String)),
  reviewMode: Schema.optional(Schema.Literals(["git", "branch", "turn"])),
  reviewFile: Schema.optional(Schema.String),
  pendingMessage: Schema.optional(Schema.String),
  pendingMessageAt: Schema.optional(Schema.Finite),
})

export const layoutSchema = Persistence.struct({
  sidebar: Persistence.struct({
    opened: Schema.Boolean,
    width: Schema.Finite,
    workspaces: Persistence.record(Schema.Boolean),
    workspacesDefault: Schema.Boolean,
  }),
  // The dock and side region state moved to per-tab regions; these fields stay so stored layouts keep decoding.
  terminal: Persistence.struct({ height: Schema.Finite, opened: Schema.Boolean }),
  review: Persistence.struct({
    panelOpened: Schema.Boolean,
    // Owned by the review extension, which copies it out once; kept so layout rewrites cannot drop it first.
    diffStyle: Schema.optional(Schema.Literals(["unified", "split"])),
  }),
  fileTree: Persistence.struct({
    opened: Schema.Boolean,
    width: Schema.Finite,
    // The file extension owns the tree's tab now. The stored field stays so the migration below
    // keeps telling current layouts from ones saved before the tab existed.
    tab: Schema.Literals(["changes", "all"]),
  }),
  session: Persistence.struct({ width: Schema.Finite }),
  mobileSidebar: Persistence.struct({ opened: Schema.Boolean }),
  sessionTabs: Persistence.record(Persistence.fallback(sessionTabsSchema, () => ({ all: [] }))),
  sessionView: Persistence.record(Persistence.fallback(sessionViewSchema, () => ({ scroll: {} }))),
  home: Persistence.struct({
    selection: Persistence.struct({
      server: Schema.optional(TabStorage.ServerKey),
      directory: Schema.optional(Schema.String),
    }),
  }),
})

export const layoutPersistence = Persistence.migrate(
  layoutSchema,
  Schema.Struct({
    sidebar: Persistence.optional(
      Schema.Struct({
        workspaces: Persistence.optional(Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Schema.Boolean)])),
        workspacesDefault: Persistence.optional(Schema.Boolean),
      }),
    ),
    review: Persistence.optional(Schema.Struct({ panelOpened: Persistence.optional(Schema.Boolean) })),
    fileTree: Persistence.optional(
      Schema.Struct({
        opened: Persistence.optional(Schema.Boolean),
        width: Persistence.optional(Schema.Finite),
        tab: Persistence.optional(Schema.Literals(["changes", "all"])),
      }),
    ),
    sessionTabs: layoutSchema.fields.sessionTabs,
    sessionView: layoutSchema.fields.sessionView,
  }).pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => ({
        ...value,
        sidebar: Predicate.isBoolean(value.sidebar?.workspaces)
          ? { ...value.sidebar, workspaces: {}, workspacesDefault: value.sidebar.workspaces }
          : value.sidebar,
        // Only an existing review section inherits the old file-tree panel flag.
        review: value.review
          ? { ...value.review, panelOpened: value.review.panelOpened ?? value.fileTree?.opened }
          : value.review,
        fileTree:
          value.fileTree && !value.fileTree.tab
            ? {
                ...value.fileTree,
                opened: true,
                width: value.fileTree.width === 260 ? DEFAULT_FILE_TREE_WIDTH : value.fileTree.width,
                tab: "changes" as const,
              }
            : value.fileTree,
        sessionTabs: Object.fromEntries(
          Object.entries(value.sessionTabs)
            .filter(([key]) => SessionStateKey.is(key))
            .map(([key, tabs]) => [key, { all: [...new Set(tabs.all)], active: tabs.active }]),
        ),
        sessionView: Object.fromEntries(Object.entries(value.sessionView).filter(([key]) => SessionStateKey.is(key))),
      })),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
)

/** The session key the user is on, whether pruning ran, and when each session key was last used. */
type SessionKeyUsage = { active: string | undefined; pruned: boolean; used: Map<string, number> }

export function initialLayout(server?: ServerConnection.Key): typeof layoutSchema.Type {
  return {
    sidebar: { opened: false, width: DEFAULT_SIDEBAR_WIDTH, workspaces: {}, workspacesDefault: false },
    terminal: { height: DEFAULT_DOCK_HEIGHT, opened: false },
    review: { panelOpened: false },
    fileTree: { opened: false, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" },
    session: { width: DEFAULT_SESSION_WIDTH },
    mobileSidebar: { opened: false },
    sessionTabs: {},
    sessionView: {},
    home: { selection: server ? { server } : {} },
  }
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  gate: false,
  init: () => {
    const servers = useServers()
    const platform = usePlatform()

    const [store, setStore, _, ready] = persisted(
      { ...Persist.global("layout"), previousKey: "layout.v6" },
      layoutPersistence,
      initialLayout(servers.list[0] ? ServerConnection.key(servers.list[0]) : undefined),
    )

    const [ephemeral, setEphemeral] = createStore<{ sessionTabPreview: Record<string, string | undefined> }>({
      sessionTabPreview: {},
    })

    // Names of other session-scoped stores, e.g. extension storage, so pruning drops them with the layout state.
    const [scoped, setScoped, , scopedReady] = persisted(
      Persist.global("layout.scoped"),
      Persistence.array(Schema.String),
      [],
    )

    const MAX_SESSION_KEYS = 50
    const PENDING_MESSAGE_TTL_MS = 2 * 60 * 1000

    const usage: SessionKeyUsage = {
      active: undefined,
      pruned: false,
      used: new Map<string, number>(),
    }

    const dropSessionState = (keys: string[]) => {
      const names = ["prompt", "file-view", ...scoped]

      for (const key of keys) {
        const scope = SessionStateKey.scope(key)
        const parts = SessionStateKey.route(key).split("/")
        const dir = parts[0]
        const session = parts[1]

        if (!dir) continue

        for (const entry of names) {
          const target = session
            ? Persist.serverSession(scope, dir, session, entry)
            : Persist.serverWorkspace(scope, dir, entry)

          void removePersisted(target, platform)
        }
      }
    }

    function prune(keep?: string) {
      if (!scopedReady()) return

      const drop = pruneSessionKeys({
        keep,
        max: MAX_SESSION_KEYS,
        used: usage.used,
        view: Object.keys(store.sessionView),
        tabs: Object.keys(store.sessionTabs),
      })

      if (drop.length === 0) return

      setStore(
        produce((draft) => {
          for (const key of drop) {
            delete draft.sessionView[key]
            delete draft.sessionTabs[key]
          }
        }),
      )

      scroll.drop(drop)
      dropSessionState(drop)
      setEphemeral(
        "sessionTabPreview",
        produce((draft) => {
          for (const key of drop) delete draft[key]
        }),
      )

      for (const key of drop) {
        usage.used.delete(key)
      }
    }

    function touch(sessionKey: string) {
      usage.active = sessionKey
      usage.used.set(sessionKey, Date.now())

      if (!ready() || !scopedReady()) return

      if (usage.pruned) return

      usage.pruned = true
      prune(sessionKey)
    }

    const scroll = createScrollPersistence({
      debounceMs: 250,
      getSnapshot: (sessionKey) => store.sessionView[sessionKey]?.scroll,
      onFlush: (sessionKey, next) => {
        const current = store.sessionView[sessionKey]
        const keep = usage.active ?? sessionKey

        if (!current) {
          setStore("sessionView", sessionKey, { scroll: next })
          prune(keep)

          return
        }

        setStore("sessionView", sessionKey, "scroll", (prev) => ({ ...prev, ...next }))
        prune(keep)
      },
    })

    const ensureKey = (key: string) => ensureSessionKey(key, touch, (sessionKey) => scroll.seed(sessionKey))

    createEffect(() => {
      if (!ready() || !scopedReady()) return

      if (usage.pruned) return
      const active = usage.active

      if (!active) return
      usage.pruned = true
      prune(active)
    })

    onMount(() => {
      const flush = () => batch(() => scroll.flushAll())

      const handleVisibility = () => {
        if (document.visibilityState !== "hidden") return
        flush()
      }

      makeEventListener(window, "pagehide", flush)
      makeEventListener(document, "visibilitychange", handleVisibility)

      onCleanup(() => {
        scroll.dispose()
      })
    })

    return {
      route: useCurrentRoute(),
      ready,
      home: {
        selection: createMemo(() => store.home.selection),
        setSelection(selection: HomeProjectSelection) {
          setStore("home", "selection", reconcile(selection))
        },
      },
      sessionState: {
        /** Records a session-scoped store, so pruning a session's layout state drops it too. */
        track(name: string) {
          untrack(() => {
            const add = () => setScoped((names) => (names.includes(name) ? names : [...names, name]))

            if (scopedReady()) return add()
            void scopedReady.promise?.then(add)
          })
        },
      },
      fileTree: {
        opened: createMemo(() => store.fileTree?.opened ?? true),
        width: createMemo(() => store.fileTree?.width ?? DEFAULT_FILE_TREE_WIDTH),
        open() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" })

            return
          }

          setStore("fileTree", "opened", true)
        },
        close() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: false, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" })

            return
          }

          setStore("fileTree", "opened", false)
        },
        toggle() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" })

            return
          }

          setStore("fileTree", "opened", (x) => !x)
        },
        resize(width: number) {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width, tab: "changes" })

            return
          }

          setStore("fileTree", "width", width)
        },
      },
      session: {
        width: createMemo(() => store.session?.width ?? DEFAULT_SESSION_WIDTH),
        resize(width: number) {
          if (!store.session) {
            setStore("session", { width })

            return
          }

          setStore("session", "width", width)
        },
      },
      mobileSidebar: {
        opened: createMemo(() => store.mobileSidebar?.opened ?? false),
        hide() {
          setStore("mobileSidebar", "opened", false)
        },
        toggle() {
          setStore("mobileSidebar", "opened", (x) => !x)
        },
      },
      pendingMessage: {
        set(sessionKey: string, messageID: string) {
          const at = Date.now()
          touch(sessionKey)
          const current = store.sessionView[sessionKey]

          if (!current) {
            setStore("sessionView", sessionKey, {
              scroll: {},
              pendingMessage: messageID,
              pendingMessageAt: at,
            })
            prune(usage.active ?? sessionKey)

            return
          }

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              draft.pendingMessage = messageID
              draft.pendingMessageAt = at
            }),
          )
        },
        consume(sessionKey: string) {
          const current = store.sessionView[sessionKey]
          const message = current?.pendingMessage
          const at = current?.pendingMessageAt

          if (!message || !at) return

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              delete draft.pendingMessage
              delete draft.pendingMessageAt
            }),
          )

          if (Date.now() - at > PENDING_MESSAGE_TTL_MS) return

          return message
        },
      },
      /** The dock and side regions of a shell tab, and the session panel width beside them. */
      view(sessionKey: string | Accessor<string>, regions: TabRegions) {
        const key = createSessionKeyReader(sessionKey, ensureKey)

        return {
          scroll(tab: string) {
            return scroll.scroll(key(), tab)
          },
          setScroll(tab: string, pos: SessionScroll) {
            scroll.setScroll(key(), tab, pos)
          },
          dock: {
            opened: regions.dockOpened,
            height: createMemo(() => regions.dockHeight() ?? DEFAULT_DOCK_HEIGHT),
            resize: regions.setDockHeight,
            open() {
              regions.setDockOpened(true)
            },
            close() {
              regions.setDockOpened(false)
            },
          },
          side: {
            opened: regions.sideOpened,
            toggle() {
              regions.setSideOpened(!regions.sideOpened())
            },
          },
          session: {
            width: createMemo(() => regions.sessionWidth() ?? DEFAULT_SESSION_WIDTH),
            resize: regions.setSessionWidth,
          },
        }
      },
      /** Side panel tabs for any session key, mounted or not. Reads are reactive. */
      panel: {
        state(session: string) {
          return store.sessionTabs[session] ?? { all: [] }
        },
        open(session: string, tab: string, launchers?: ReadonlySet<string>, first?: boolean) {
          const next = openSessionTab(
            { tabs: store.sessionTabs[session] ?? { all: [] }, preview: ephemeral.sessionTabPreview[session] },
            tab,
            launchers,
            first,
          )

          batch(() => {
            setStore("sessionTabs", session, next.tabs)
            setEphemeral("sessionTabPreview", session, next.preview)
          })
        },
        preview(session: string, tab: string, launchers?: ReadonlySet<string>) {
          const next = previewSessionTab(
            { tabs: store.sessionTabs[session] ?? { all: [] }, preview: ephemeral.sessionTabPreview[session] },
            tab,
            launchers,
          )

          batch(() => {
            setStore("sessionTabs", session, next.tabs)
            setEphemeral("sessionTabPreview", session, next.preview)
          })
        },
        /** Adds a tab at the end of the strip without selecting it or touching the preview. */
        append(session: string, tab: string) {
          const current = store.sessionTabs[session]

          if (!current) return setStore("sessionTabs", session, { all: [tab] })

          if (current.all.includes(tab)) return
          setStore("sessionTabs", session, "all", current.all.length, tab)
        },
        focus(session: string, tab: string) {
          if (!store.sessionTabs[session]) {
            setStore("sessionTabs", session, { all: [], active: tab })

            return
          }

          setStore("sessionTabs", session, "active", tab)
        },
        close(session: string, tab: string) {
          const current = store.sessionTabs[session]

          if (!current) return
          const next = closeSessionTab({ tabs: current, preview: ephemeral.sessionTabPreview[session] }, tab)
          batch(() => {
            setStore("sessionTabs", session, next.tabs)
            setEphemeral("sessionTabPreview", session, next.preview)
          })
        },
        /**
         * Replaces `to`'s strip, selection, preview tab and scroll offsets with copies of `from`'s, keeping `from`; a key
         * with nothing stored copies as empty. `to` counts as just used, then pruning runs as for any new key.
         */
        copy(from: string, to: string) {
          const current = store.sessionTabs[from]
          usage.used.set(to, Date.now())
          batch(() => {
            scroll.flush(from)
            setStore("sessionTabs", to, { all: [...(current?.all ?? [])], active: current?.active })
            setEphemeral("sessionTabPreview", to, ephemeral.sessionTabPreview[from])
            scroll.drop([to])
            setStore("sessionView", to, {
              scroll: Object.fromEntries(
                Object.entries(store.sessionView[from]?.scroll ?? {}).map(([key, value]) => [
                  key,
                  { x: value.x, y: value.y },
                ]),
              ),
            })
            prune(usage.active ?? to)
          })
        },
        scroll(session: string, tab: string) {
          return scroll.scroll(session, tab)
        },
        setScroll(session: string, tab: string, pos: SessionScroll) {
          scroll.setScroll(session, tab, pos)
        },
      },
      tabs(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const tabs = createMemo(() => store.sessionTabs[key()] ?? { all: [] })

        const apply = (session: string, next: ReturnType<typeof openSessionTab>) => {
          batch(() => {
            setStore("sessionTabs", session, next.tabs)
            setEphemeral("sessionTabPreview", session, next.preview)
          })
        }

        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all),
          preview: createMemo(() => ephemeral.sessionTabPreview[key()]),
          setActive(tab: string | undefined) {
            const session = key()

            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: [], active: tab })
            } else {
              setStore("sessionTabs", session, "active", tab)
            }
          },
          setAll(all: string[]) {
            const session = key()
            batch(() => {
              if (!store.sessionTabs[session]) {
                setStore("sessionTabs", session, { all, active: undefined })
              } else {
                setStore("sessionTabs", session, "all", all)
              }

              const preview = ephemeral.sessionTabPreview[session]

              if (preview && !all.includes(preview)) setEphemeral("sessionTabPreview", session, undefined)
            })
          },
          /** Rewrites every stored key, the selected tab and the preview together; keys that collapse into one dedupe. */
          remap(rewrite: (tab: string) => string) {
            const session = key()
            const current = store.sessionTabs[session]

            if (!current) return
            const all = Array.from(new Set(current.all.map(rewrite)))
            const active = current.active === undefined ? undefined : rewrite(current.active)
            const preview = ephemeral.sessionTabPreview[session]
            // A preview that collapses into a kept tab becomes that kept tab: kept wins.
            const kept = new Set(current.all.filter((tab) => tab !== preview).map(rewrite))
            const renamed = preview === undefined ? undefined : rewrite(preview)
            const nextPreview = renamed !== undefined && kept.has(renamed) ? undefined : renamed
            const changed = all.length !== current.all.length || all.some((tab, index) => tab !== current.all[index])

            if (!changed && active === current.active && nextPreview === preview) return
            batch(() => {
              setStore("sessionTabs", session, { ...current, all, active })
              setEphemeral("sessionTabPreview", session, nextPreview)
            })
          },
          async open(tab: string) {
            const session = key()
            apply(
              session,
              openSessionTab(
                { tabs: store.sessionTabs[session] ?? { all: [] }, preview: ephemeral.sessionTabPreview[session] },
                tab,
              ),
            )
          },
          previewTab(tab: string) {
            const session = key()
            apply(
              session,
              previewSessionTab(
                { tabs: store.sessionTabs[session] ?? { all: [] }, preview: ephemeral.sessionTabPreview[session] },
                tab,
              ),
            )
          },
          close(tab: string) {
            const session = key()
            const current = store.sessionTabs[session]

            if (!current) return
            apply(session, closeSessionTab({ tabs: current, preview: ephemeral.sessionTabPreview[session] }, tab))
          },
          move(tab: string, to: number) {
            const session = key()
            const current = store.sessionTabs[session]

            if (!current) return
            const index = current.all.findIndex((f) => f === tab)

            if (index === -1) return
            setStore(
              "sessionTabs",
              session,
              "all",
              produce((opened) => {
                opened.splice(to, 0, opened.splice(index, 1)[0])
              }),
            )
          },
        }
      },
    }
  },
})
