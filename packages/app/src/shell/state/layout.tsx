import { createStore, produce, reconcile } from "solid-js/store"
import { Schema, SchemaGetter } from "effect"
import { batch, createEffect, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { useLocation } from "@solidjs/router"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { makeEventListener } from "@solid-primitives/event-listener"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { usePlatform } from "@/runtime/platform/platform"
import type { Project } from "@/runtime/server/types"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { TabStorage } from "@/shell/tabs/schema"
import { decode64 } from "@/runtime/persistence/base64"
import { same } from "@/runtime/persistence/equality"
import { createScrollPersistence, type SessionScroll } from "./scroll"
import { createPathHelpers } from "@/workspaces/files/path"
import type { ProjectAvatarVariant } from "@opencode-ai/ui/project-avatar"
import { SessionStateKey } from "@/runtime/server/scope"
import { createSessionKeyReader, ensureSessionKey, pruneSessionKeys } from "./helpers"
import { requireServerKey } from "@/shell/routes/session"
import { closeSessionTab, openSessionTab, previewSessionTab, type SessionTabs } from "./session-tabs"

export { createSessionKeyReader, ensureSessionKey, pruneSessionKeys }

export type { ProjectAvatarVariant }

const DEFAULT_SIDEBAR_WIDTH = 344
const DEFAULT_FILE_TREE_WIDTH = 200
const DEFAULT_SESSION_WIDTH = 600
const DEFAULT_TERMINAL_HEIGHT = 280
const DEFAULT_REVIEW_PANEL_OPENED = false
export function getProjectAvatarVariant(key?: string): ProjectAvatarVariant {
  if (key === "mint") return "cyan"
  if (key === "lime") return "green"
  if (
    key === "orange" ||
    key === "yellow" ||
    key === "cyan" ||
    key === "green" ||
    key === "red" ||
    key === "pink" ||
    key === "blue" ||
    key === "purple" ||
    key === "gray"
  )
    return key
  return "gray"
}

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }
export type HomeProjectSelection = typeof layoutSchema.Type.home.selection

export type ReviewDiffStyle = typeof layoutSchema.Type.review.diffStyle
export type ReviewChangeMode = NonNullable<(typeof layoutSchema.Type.sessionView)[string]["reviewMode"]>
export type ReviewPanelSource = "context-button" | "other"
export type TabPanes = {
  terminalOpened: Accessor<boolean>
  setTerminalOpened(opened: boolean): void
  terminalHeight: Accessor<number | undefined>
  setTerminalHeight(height: number): void
  reviewOpened: Accessor<boolean>
  setReviewOpened(opened: boolean): void
  sessionWidth: Accessor<number | undefined>
  setSessionWidth(width: number): void
}

export type LayoutRoute =
  | { type: "home" }
  | { type: "settings" }
  | { type: "draft"; draftID: string }
  | { type: "session"; sessionId: string; server: ServerConnection.Key }

const sessionPath = (key: string) => {
  const dir = SessionStateKey.route(key).split("/")[0]
  if (!dir) return
  const root = decode64(dir)
  if (!root) return
  return createPathHelpers(() => root)
}

const normalizeSessionTab = (path: ReturnType<typeof createPathHelpers> | undefined, tab: string) => {
  if (!tab.startsWith("file://")) return tab
  if (!path) return tab
  return path.tab(tab)
}

const normalizeSessionTabList = (path: ReturnType<typeof createPathHelpers> | undefined, all: string[]) => {
  const seen = new Set<string>()
  return all.flatMap((tab) => {
    const value = normalizeSessionTab(path, tab)
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

const normalizeStoredSessionTabs = (key: string, tabs: SessionTabs) => {
  const path = sessionPath(key)
  return {
    all: normalizeSessionTabList(path, tabs.all),
    active: tabs.active ? normalizeSessionTab(path, tabs.active) : tabs.active,
  }
}

export const currentRoute = (pathname: string, search: string): LayoutRoute => {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length === 0) return { type: "home" }
  if (parts[0] === "settings") return { type: "settings" }

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
  terminal: Persistence.struct({ height: Schema.Finite, opened: Schema.Boolean }),
  review: Persistence.struct({
    diffStyle: Schema.Literals(["unified", "split"]),
    panelOpened: Schema.Boolean,
  }),
  fileTree: Persistence.struct({
    opened: Schema.Boolean,
    width: Schema.Finite,
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
        sidebar:
          typeof value.sidebar?.workspaces === "boolean"
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
            .map(([key, tabs]) => [key, normalizeStoredSessionTabs(key, tabs)]),
        ),
        sessionView: Object.fromEntries(Object.entries(value.sessionView).filter(([key]) => SessionStateKey.is(key))),
      })),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
)

export function initialLayout(server?: ServerConnection.Key): typeof layoutSchema.Type {
  return {
    sidebar: { opened: false, width: DEFAULT_SIDEBAR_WIDTH, workspaces: {}, workspacesDefault: false },
    terminal: { height: DEFAULT_TERMINAL_HEIGHT, opened: false },
    review: { diffStyle: "split", panelOpened: DEFAULT_REVIEW_PANEL_OPENED },
    fileTree: { opened: false, width: DEFAULT_FILE_TREE_WIDTH, tab: "changes" },
    session: { width: DEFAULT_SESSION_WIDTH },
    mobileSidebar: { opened: false },
    sessionTabs: {},
    sessionView: {},
    home: { selection: { server } },
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
    const [ephemeral, setEphemeral] = createStore({
      reviewPanelSource: "other" as ReviewPanelSource,
      sessionTabPreview: {} as Record<string, string | undefined>,
    })

    const MAX_SESSION_KEYS = 50
    const PENDING_MESSAGE_TTL_MS = 2 * 60 * 1000
    const usage = {
      active: undefined as string | undefined,
      pruned: false,
      used: new Map<string, number>(),
    }

    const SESSION_STATE_KEYS = ["prompt", "terminal", "file-view"] as const

    const dropSessionState = (keys: string[]) => {
      for (const key of keys) {
        const scope = SessionStateKey.scope(key)
        const parts = SessionStateKey.route(key).split("/")
        const dir = parts[0]
        const session = parts[1]
        if (!dir) continue

        for (const entry of SESSION_STATE_KEYS) {
          const target = session
            ? Persist.serverSession(scope, dir, session, entry)
            : Persist.serverWorkspace(scope, dir, entry)
          void removePersisted(target, platform)
        }
      }
    }

    function prune(keep?: string) {
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

      if (!ready()) return
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
      if (!ready()) return
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
      terminal: {
        height: createMemo(() => store.terminal.height),
        resize(height: number) {
          setStore("terminal", "height", height)
        },
      },
      review: {
        diffStyle: createMemo(() => store.review?.diffStyle ?? "split"),
        setDiffStyle(diffStyle: ReviewDiffStyle) {
          if (!store.review) {
            setStore("review", { diffStyle, panelOpened: DEFAULT_REVIEW_PANEL_OPENED })
            return
          }
          setStore("review", "diffStyle", diffStyle)
        },
      },
      fileTree: {
        opened: createMemo(() => store.fileTree?.opened ?? true),
        width: createMemo(() => store.fileTree?.width ?? DEFAULT_FILE_TREE_WIDTH),
        tab: createMemo(() => store.fileTree?.tab ?? "changes"),
        setTab(tab: "changes" | "all") {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab })
            return
          }
          setStore("fileTree", "tab", tab)
        },
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
      view(sessionKey: string | Accessor<string>, panes?: TabPanes) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const s = createMemo(() => store.sessionView[key()] ?? { scroll: {} })
        const reviewMode = createMemo(() => {
          const mode = s().reviewMode
          if (mode === "git" || mode === "branch" || mode === "turn") return mode
        })
        const reviewFile = createMemo(() => {
          const file = s().reviewFile
          if (typeof file === "string") return file
        })
        const terminalOpened = panes?.terminalOpened ?? createMemo(() => store.terminal?.opened ?? false)
        const terminalHeight = createMemo(() =>
          panes
            ? (panes.terminalHeight() ?? DEFAULT_TERMINAL_HEIGHT)
            : (store.terminal?.height ?? DEFAULT_TERMINAL_HEIGHT),
        )
        const reviewPanelOpened =
          panes?.reviewOpened ?? createMemo(() => store.review?.panelOpened ?? DEFAULT_REVIEW_PANEL_OPENED)
        const sessionWidth = createMemo(() =>
          panes ? (panes.sessionWidth() ?? DEFAULT_SESSION_WIDTH) : store.session.width,
        )
        const reviewPanelSource = createMemo(() => (reviewPanelOpened() ? ephemeral.reviewPanelSource : "other"))

        function setTerminalOpened(next: boolean) {
          if (panes) {
            panes.setTerminalOpened(next)
            return
          }
          const current = store.terminal
          if (!current) {
            setStore("terminal", { height: DEFAULT_TERMINAL_HEIGHT, opened: next })
            return
          }

          const value = current.opened ?? false
          if (value === next) return
          setStore("terminal", "opened", next)
        }

        function setReviewPanelOpened(next: boolean, source: ReviewPanelSource) {
          const nextSource = next ? source : "other"
          if (panes) {
            batch(() => {
              panes.setReviewOpened(next)
              setEphemeral("reviewPanelSource", nextSource)
            })
            return
          }
          const current = store.review
          if (!current) {
            batch(() => {
              setStore("review", { diffStyle: "split" as ReviewDiffStyle, panelOpened: next })
              setEphemeral("reviewPanelSource", nextSource)
            })
            return
          }

          const value = current.panelOpened ?? DEFAULT_REVIEW_PANEL_OPENED
          if (value === next) {
            if (ephemeral.reviewPanelSource !== nextSource) setEphemeral("reviewPanelSource", nextSource)
            return
          }
          batch(() => {
            setStore("review", "panelOpened", next)
            setEphemeral("reviewPanelSource", nextSource)
          })
        }

        return {
          scroll(tab: string) {
            return scroll.scroll(key(), tab)
          },
          setScroll(tab: string, pos: SessionScroll) {
            scroll.setScroll(key(), tab, pos)
          },
          terminal: {
            opened: terminalOpened,
            height: terminalHeight,
            resize(height: number) {
              if (panes) {
                panes.setTerminalHeight(height)
                return
              }
              setStore("terminal", "height", height)
            },
            open() {
              setTerminalOpened(true)
            },
            close() {
              setTerminalOpened(false)
            },
            toggle() {
              setTerminalOpened(!terminalOpened())
            },
          },
          reviewPanel: {
            opened: reviewPanelOpened,
            source: reviewPanelSource,
            width: sessionWidth,
            resize(width: number) {
              if (panes) {
                panes.setSessionWidth(width)
                return
              }
              setStore("session", "width", width)
            },
            open(source: ReviewPanelSource = "other") {
              setReviewPanelOpened(true, source)
            },
            close() {
              setReviewPanelOpened(false, "other")
            },
            toggle() {
              setReviewPanelOpened(!reviewPanelOpened(), "other")
            },
          },
          review: {
            mode: reviewMode,
            setMode(mode: ReviewChangeMode) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, { scroll: {}, reviewMode: mode })
                prune(session)
                return
              }
              if (current.reviewMode === mode) return
              setStore("sessionView", session, "reviewMode", mode)
              prune(session)
            },
            file: reviewFile,
            setFile(file: string) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, { scroll: {}, reviewFile: file })
                prune(session)
                return
              }
              if (current.reviewFile === file) return
              setStore("sessionView", session, "reviewFile", file)
              prune(session)
            },
            open: createMemo(() => s().reviewOpen ?? []),
            setOpen(open: string[]) {
              const session = key()
              const next = Array.from(new Set(open))
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: next,
                })
                return
              }

              if (same(current.reviewOpen, next)) return
              setStore("sessionView", session, "reviewOpen", next)
            },
            openPath(path: string) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: [path],
                })
                return
              }

              if (!current.reviewOpen) {
                setStore("sessionView", session, "reviewOpen", [path])
                return
              }

              if (current.reviewOpen.includes(path)) return
              setStore("sessionView", session, "reviewOpen", current.reviewOpen.length, path)
            },
          },
        }
      },
      tabs(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const path = createMemo(() => sessionPath(key()))
        const tabs = createMemo(() => store.sessionTabs[key()] ?? { all: [] })
        const normalize = (tab: string) => normalizeSessionTab(path(), tab)
        const normalizeAll = (all: string[]) => normalizeSessionTabList(path(), all)
        const apply = (session: string, next: ReturnType<typeof openSessionTab>) => {
          batch(() => {
            setStore("sessionTabs", session, next.tabs)
            setEphemeral("sessionTabPreview", session, next.preview)
          })
        }
        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all.filter((tab) => tab !== "review")),
          preview: createMemo(() => ephemeral.sessionTabPreview[key()]),
          setActive(tab: string | undefined) {
            const session = key()
            const next = tab ? normalize(tab) : tab
            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: [], active: next })
            } else {
              setStore("sessionTabs", session, "active", next)
            }
          },
          setAll(all: string[]) {
            const session = key()
            const next = normalizeAll(all).filter((tab) => tab !== "review")
            batch(() => {
              if (!store.sessionTabs[session]) {
                setStore("sessionTabs", session, { all: next, active: undefined })
              } else {
                setStore("sessionTabs", session, "all", next)
              }
              const preview = ephemeral.sessionTabPreview[session]
              if (preview && !next.includes(preview)) setEphemeral("sessionTabPreview", session, undefined)
            })
          },
          async open(tab: string) {
            const session = key()
            apply(
              session,
              openSessionTab(
                { tabs: store.sessionTabs[session] ?? { all: [] }, preview: ephemeral.sessionTabPreview[session] },
                normalize(tab),
              ),
            )
          },
          previewTab(tab: string) {
            const session = key()
            apply(
              session,
              previewSessionTab(
                { tabs: store.sessionTabs[session] ?? { all: [] }, preview: ephemeral.sessionTabPreview[session] },
                normalize(tab),
              ),
            )
          },
          close(tab: string) {
            const session = key()
            const current = store.sessionTabs[session]
            if (!current) return
            apply(
              session,
              closeSessionTab({ tabs: current, preview: ephemeral.sessionTabPreview[session] }, normalize(tab)),
            )
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
