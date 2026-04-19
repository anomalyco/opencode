import { createRoot, getOwner, onCleanup, runWithOwner, type Owner } from "solid-js"
import { createStore, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
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

const snap = (value: unknown) => {
  if (Array.isArray(value)) {
    return {
      kind: "array",
      size: value.length,
      ids: value.slice(0, 3).map((item) => {
        if (!item || typeof item !== "object") return undefined
        if (!("id" in item)) return undefined
        return String((item as { id?: unknown }).id ?? "")
      }),
      types: value.slice(0, 3).map((item) => {
        if (!item || typeof item !== "object") return undefined
        if (!("type" in item)) return undefined
        return String((item as { type?: unknown }).type ?? "")
      }),
    }
  }
  if (typeof value === "function") return { kind: "fn" }
  if (value && typeof value === "object") {
    return {
      kind: "object",
      keys: Object.keys(value as Record<string, unknown>).slice(0, 6),
    }
  }
  return value
}

const dump = (input: unknown[]) => input.slice(0, 3).map(snap)

export function createChildStoreManager(input: {
  owner: Owner
  isBooting: (directory: string) => boolean
  isLoadingSessions: (directory: string) => boolean
  onBootstrap: (directory: string) => void
  onDispose: (directory: string) => void
  translate: (key: string, vars?: Record<string, string | number>) => string
}) {
  const seed = (input: { meta: ProjectMeta | undefined; icon: string | undefined; vcs: VcsInfo | undefined }) => ({
    project: "",
    projectMeta: input.meta,
    icon: input.icon,
    provider: { all: [], connected: [], default: {} },
    config: {},
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    status: "loading" as const,
    sessions: "idle" as const,
    session_error: undefined as string | undefined,
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
    vcs: input.vcs,
    limit: 5,
    message: {},
    part: {},
  })

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

    console.debug(
      `[child-store] dispose dir=${directory} pin=${pins.get(directory) ?? 0} boot=${input.isBooting(directory) ? 1 : 0} load=${input.isLoadingSessions(directory) ? 1 : 0}`,
    )
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
      if (!vcs) throw new Error(input.translate("error.childStore.persistedCacheCreateFailed"))
      const vcsStore = vcs[0]
      vcsCache.set(directory, { store: vcsStore, setStore: vcs[1], ready: vcs[3] })

      const meta = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "project", ["project.v1"]),
          createStore({ value: undefined as ProjectMeta | undefined }),
        ),
      )
      if (!meta) throw new Error(input.translate("error.childStore.persistedProjectMetadataCreateFailed"))
      metaCache.set(directory, { store: meta[0], setStore: meta[1], ready: meta[3] })

      const icon = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "icon", ["icon.v1"]),
          createStore({ value: undefined as string | undefined }),
        ),
      )
      if (!icon) throw new Error(input.translate("error.childStore.persistedProjectIconCreateFailed"))
      iconCache.set(directory, { store: icon[0], setStore: icon[1], ready: icon[3] })

      const init = () =>
        createRoot((dispose) => {
          const initialMeta = meta[0].value
          const initialIcon = icon[0].value
          const child = createStore<State>(seed({ meta: initialMeta, icon: initialIcon, vcs: vcsStore.value }))
          const raw = child[1] as (...args: unknown[]) => unknown
          const set = ((...args: unknown[]) => {
            if (args[0] === "part") {
              const msg = typeof args[1] === "string" ? args[1] : "?"
              console.debug(
                `[child-store] part dir=${directory} msg=${msg} alive=${!!children[directory]} same=${children[directory]?.[1] === set ? 1 : 0} value=${JSON.stringify(snap(args[2]))}`,
              )
            }
            try {
              return raw(...args)
            } catch (err) {
              console.error("[child-store] set failed", {
                directory,
                alive: !!children[directory],
                same: children[directory]?.[1] === set,
                state: {
                  status: child[0].status,
                  sessions: child[0].sessions,
                  path: child[0].path.directory,
                  part: Object.keys(child[0].part).slice(0, 5),
                  message: Object.keys(child[0].message).slice(0, 5),
                },
                args: dump(args),
                err,
              })
              throw err
            }
          }) as typeof child[1]
          children[directory] = [child[0], set]
          disposers.set(directory, dispose)
          console.debug(`[child-store] create dir=${directory}`)

          const onPersistedInit = (init: Promise<string> | string | null, run: () => void) => {
            if (!(init instanceof Promise)) return
            void init.then(() => {
              if (children[directory] !== child) return
              run()
            })
          }

          onPersistedInit(vcs[2], () => {
            const cached = vcsStore.value
            if (!cached?.branch) return
            // Only use cached VCS if bootstrap hasn't run yet (status is still "loading")
            if (child[0].status !== "loading") return
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
    const childStore = children[directory]
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

  function resetDirectory(directory: string) {
    const child = children[directory]
    if (!child) return
    const vcs = vcsCache.get(directory)?.store.value
    const meta = metaCache.get(directory)?.store.value
    const icon = iconCache.get(directory)?.store.value
    // Preserve local persisted project metadata while wiping server-derived state.
    console.debug(`[child-store] reset dir=${directory}`)
    child[1](reconcile(seed({ meta, icon, vcs })))
  }

  return {
    children,
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
    resetDirectory,
    runEviction,
    vcsCache,
    metaCache,
    iconCache,
  }
}
