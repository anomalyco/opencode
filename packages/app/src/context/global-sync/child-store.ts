import { createRoot, getOwner, onCleanup, runWithOwner, type Owner } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import type { VcsInfo } from "@opencode-ai/sdk/v2/client"
import {
  DIR_IDLE_TTL_MS,
  MAX_DIR_STORES,
  type ChildOptions,
  type DirState,
  type IconCache,
  type MetaCache,
  type ProjectMeta,
  type State,
  type VcsCache,
} from "./types"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./eviction"
import { workspaceKey } from "@/pages/layout/helpers"

export function createChildStoreManager(input: {
  owner: Owner
  isBooting: (directory: string) => boolean
  isLoadingSessions: (directory: string) => boolean
  onBootstrap: (directory: string) => void
  onDispose: (directory: string) => void
  translate: (key: string, vars?: Record<string, string | number>) => string
}) {
  const children: Record<string, [Store<State>, SetStoreFunction<State>]> = {}
  const vcsCache = new Map<string, VcsCache>()
  const metaCache = new Map<string, MetaCache>()
  const iconCache = new Map<string, IconCache>()
  const lifecycle = new Map<string, DirState>()
  const pins = new Map<string, number>()
  const ownerPins = new WeakMap<object, Set<string>>()
  const disposers = new Map<string, () => void>()
  const canonicalDir = new Map<string, string>()

  const mark = (directory: string) => {
    if (!directory) return
    const k = workspaceKey(directory)
    lifecycle.set(k, { lastAccessAt: Date.now() })
    runEviction(k)
  }

  const pin = (directory: string) => {
    if (!directory) return
    const k = workspaceKey(directory)
    pins.set(k, (pins.get(k) ?? 0) + 1)
    mark(directory)
  }

  const unpin = (directory: string) => {
    if (!directory) return
    const k = workspaceKey(directory)
    const next = (pins.get(k) ?? 0) - 1
    if (next > 0) {
      pins.set(k, next)
      return
    }
    pins.delete(k)
    runEviction()
  }

  const pinned = (directory: string) => (pins.get(workspaceKey(directory)) ?? 0) > 0

  const pinForOwner = (directory: string) => {
    const current = getOwner()
    if (!current) return
    if (current === input.owner) return
    const key = current as object
    const set = ownerPins.get(key)
    if (set?.has(directory)) return
    if (set) set.add(directory)
    if (!set) ownerPins.set(key, new Set([directory]))
    pin(directory)
    onCleanup(() => {
      const set = ownerPins.get(key)
      if (set) {
        set.delete(directory)
        if (set.size === 0) ownerPins.delete(key)
      }
      unpin(directory)
    })
  }

  function disposeDirectory(directory: string) {
    const key = workspaceKey(directory)
    const orig = canonicalDir.get(key) ?? directory
    if (
      !canDisposeDirectory({
        directory: orig,
        hasStore: !!children[key],
        pinned: pinned(directory),
        booting: input.isBooting(orig),
        loadingSessions: input.isLoadingSessions(orig),
      })
    ) {
      return false
    }

    vcsCache.delete(key)
    metaCache.delete(key)
    iconCache.delete(key)
    lifecycle.delete(key)
    canonicalDir.delete(key)
    const dispose = disposers.get(key)
    if (dispose) {
      dispose()
      disposers.delete(key)
    }
    delete children[key]
    input.onDispose(orig)
    return true
  }

  function runEviction(skip?: string) {
    const stores = Object.keys(children)
    if (stores.length === 0) return
    const list = pickDirectoriesToEvict({
      stores,
      state: lifecycle,
      pins: new Set(stores.filter(pinned)),
      max: MAX_DIR_STORES,
      ttl: DIR_IDLE_TTL_MS,
      now: Date.now(),
    }).filter((directory) => directory !== skip)
    if (list.length === 0) return
    for (const directory of list) {
      if (!disposeDirectory(directory)) continue
    }
  }

  function ensureChild(directory: string) {
    if (!directory) console.error("No directory provided")
    const key = workspaceKey(directory)
    // Prefer backslash format on Windows for API calls that need server-side exact match.
    // If backslash path is available, always use it as the canonical form.
    if (!canonicalDir.has(key) || directory.includes("\\")) canonicalDir.set(key, directory)
    if (!children[key]) {
      const vcs = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "vcs", ["vcs.v1"]),
          createStore({ value: undefined as VcsInfo | undefined }),
        ),
      )
      if (!vcs) throw new Error(input.translate("error.childStore.persistedCacheCreateFailed"))
      const vcsStore = vcs[0]
      vcsCache.set(key, { store: vcsStore, setStore: vcs[1], ready: vcs[3] })

      const meta = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "project", ["project.v1"]),
          createStore({ value: undefined as ProjectMeta | undefined }),
        ),
      )
      if (!meta) throw new Error(input.translate("error.childStore.persistedProjectMetadataCreateFailed"))
      metaCache.set(key, { store: meta[0], setStore: meta[1], ready: meta[3] })

      const icon = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "icon", ["icon.v1"]),
          createStore({ value: undefined as string | undefined }),
        ),
      )
      if (!icon) throw new Error(input.translate("error.childStore.persistedProjectIconCreateFailed"))
      iconCache.set(key, { store: icon[0], setStore: icon[1], ready: icon[3] })

      const init = () =>
        createRoot((dispose) => {
          const initialMeta = meta[0].value
          const initialIcon = icon[0].value
          const child = createStore<State>({
            project: "",
            projectMeta: initialMeta,
            icon: initialIcon,
            provider_ready: false,
            provider: { all: [], connected: [], default: {} },
            config: {},
            path: { state: "", config: "", worktree: "", directory: "", home: "" },
            status: "loading" as const,
            agent: [],
            command: [],
            session: [],
            sessionTotal: 0,
            session_status: {},
            session_diff: {},
            todo: {},
            permission: {},
            question: {},
            mcp_ready: false,
            mcp: {},
            lsp_ready: false,
            lsp: [],
            vcs: vcsStore.value,
            limit: 5,
            message: {},
            part: {},
          })
          children[key] = child
          disposers.set(key, dispose)

          const onPersistedInit = (init: Promise<string> | string | null, run: () => void) => {
            if (!(init instanceof Promise)) return
            void init.then(() => {
              if (children[key] !== child) return
              run()
            })
          }

          onPersistedInit(vcs[2], () => {
            const cached = vcsStore.value
            if (!cached?.branch) return
            child[1]("vcs", (value) => value ?? cached)
          })

          onPersistedInit(meta[2], () => {
            if (child[0].projectMeta !== initialMeta) return
            child[1]("projectMeta", meta[0].value)
          })

          onPersistedInit(icon[2], () => {
            if (child[0].icon !== initialIcon) return
            child[1]("icon", icon[0].value)
          })
        })

      runWithOwner(input.owner, init)
    }
    mark(directory)
    const childStore = children[key]
    if (!childStore) throw new Error(input.translate("error.childStore.storeCreateFailed"))
    return childStore
  }

  function child(directory: string, options: ChildOptions = {}) {
    const childStore = ensureChild(directory)
    pinForOwner(directory)
    const shouldBootstrap = options.bootstrap ?? true
    if (shouldBootstrap && childStore[0].status === "loading") {
      input.onBootstrap(directory)
    }
    return childStore
  }

  function peek(directory: string, options: ChildOptions = {}) {
    const childStore = ensureChild(directory)
    const shouldBootstrap = options.bootstrap ?? true
    if (shouldBootstrap && childStore[0].status === "loading") {
      input.onBootstrap(directory)
    }
    return childStore
  }

  function projectMeta(directory: string, patch: ProjectMeta) {
    const [store, setStore] = ensureChild(directory)
    const cached = metaCache.get(workspaceKey(directory))
    if (!cached) return
    const previous = store.projectMeta ?? {}
    const icon = patch.icon ? { ...(previous.icon ?? {}), ...patch.icon } : previous.icon
    const commands = patch.commands ? { ...(previous.commands ?? {}), ...patch.commands } : previous.commands
    const next = {
      ...previous,
      ...patch,
      icon,
      commands,
    }
    cached.setStore("value", next)
    setStore("projectMeta", next)
  }

  function projectIcon(directory: string, value: string | undefined) {
    const [store, setStore] = ensureChild(directory)
    const cached = iconCache.get(workspaceKey(directory))
    if (!cached) return
    if (store.icon === value) return
    cached.setStore("value", value)
    setStore("icon", value)
  }

  return {
    children,
    canonicalDir,
    ensureChild,
    child,
    peek,
    projectMeta,
    projectIcon,
    mark,
    pin,
    unpin,
    pinned,
    disposeDirectory,
    runEviction,
    vcsCache,
    metaCache,
    iconCache,
  }
}
