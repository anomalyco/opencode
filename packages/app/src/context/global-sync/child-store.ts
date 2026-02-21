import { createRoot, createEffect, getOwner, onCleanup, runWithOwner, type Accessor, type Owner } from "solid-js"
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

export function createChildStoreManager(input: {
  owner: Owner
  isBooting: (directory: string) => boolean
  isLoadingSessions: (directory: string) => boolean
  onBootstrap: (directory: string) => void
  onDispose: (directory: string) => void
}) {
  const children: Record<string, [Store<State>, SetStoreFunction<State>]> = {}
  const vcsCache = new Map<string, VcsCache>()
  const metaCache = new Map<string, MetaCache>()
  const iconCache = new Map<string, IconCache>()
  const lifecycle = new Map<string, DirState>()
  const pins = new Map<string, number>()
  const ownerPins = new WeakMap<object, Set<string>>()
  const disposers = new Map<string, () => void>()

  const mark = (directory: string) => {
    if (!directory) return
    lifecycle.set(directory, { lastAccessAt: Date.now() })
    runEviction(directory)
  }

  const pin = (directory: string) => {
    if (!directory) return
    pins.set(directory, (pins.get(directory) ?? 0) + 1)
    mark(directory)
  }

  const unpin = (directory: string) => {
    if (!directory) return
    const next = (pins.get(directory) ?? 0) - 1
    if (next > 0) {
      pins.set(directory, next)
      return
    }
    pins.delete(directory)
    runEviction()
  }

  const pinned = (directory: string) => (pins.get(directory) ?? 0) > 0

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
    if (
      !canDisposeDirectory({
        directory,
        hasStore: !!children[directory],
        pinned: pinned(directory),
        booting: input.isBooting(directory),
        loadingSessions: input.isLoadingSessions(directory),
      })
    ) {
      return false
    }

    vcsCache.delete(directory)
    metaCache.delete(directory)
    iconCache.delete(directory)
    lifecycle.delete(directory)
    const dispose = disposers.get(directory)
    if (dispose) {
      dispose()
      disposers.delete(directory)
    }
    delete children[directory]
    input.onDispose(directory)
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
    if (!children[directory]) {
      const vcs = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "vcs", ["vcs.v1"]),
          createStore({ value: undefined as VcsInfo | undefined }),
        ),
      )
      if (!vcs) throw new Error("Failed to create persisted cache")
      const vcsStore = vcs[0]
      const vcsReady = vcs[3]
      vcsCache.set(directory, { store: vcsStore, setStore: vcs[1], ready: vcsReady })

      const meta = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "project", ["project.v1"]),
          createStore({ value: undefined as ProjectMeta | undefined }),
        ),
      )
      if (!meta) throw new Error("Failed to create persisted project metadata")
      metaCache.set(directory, { store: meta[0], setStore: meta[1], ready: meta[3] })

      const icon = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "icon", ["icon.v1"]),
          createStore({ value: undefined as string | undefined }),
        ),
      )
      if (!icon) throw new Error("Failed to create persisted project icon")
      iconCache.set(directory, { store: icon[0], setStore: icon[1], ready: icon[3] })

      const init = () =>
        createRoot((dispose) => {
          const child = createStore<State>({
            project: "",
            projectMeta: meta[0].value,
            icon: icon[0].value,
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
            mcp: {},
            lsp: [],
            vcs: vcsStore.value,
            limit: 5,
            message: {},
            part: {},
          })
          children[directory] = child
          disposers.set(directory, dispose)

          createEffect(() => {
            if (!vcsReady()) return
            const cached = vcsStore.value
            if (!cached?.branch) return
            child[1]("vcs", (value) => value ?? cached)
          })
          createEffect(() => {
            child[1]("projectMeta", meta[0].value)
          })
          createEffect(() => {
            child[1]("icon", icon[0].value)
          })
        })

      runWithOwner(input.owner, init)
    }
    mark(directory)
    const childStore = children[directory]
    if (!childStore) throw new Error("Failed to create store")
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

  function projectMeta(directory: string, patch: ProjectMeta) {
    const [store, setStore] = ensureChild(directory)
    const cached = metaCache.get(directory)
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
    const cached = iconCache.get(directory)
    if (!cached) return
    if (store.icon === value) return
    cached.setStore("value", value)
    setStore("icon", value)
  }

  return {
    children,
    ensureChild,
    child,
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
