import { getOwner, onCleanup, runWithOwner, type Owner } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/runtime/persistence/storage"
import type { Path } from "@/runtime/server/types"
import type { ProjectMeta, State } from "./types"
import { createDirectoryCacheState, transitionDirectoryCache, type DirectoryCacheEvent } from "./machine"
import { directoryKey, type DirectoryKey } from "./utils"
import type { ServerScope } from "@/runtime/server/scope"
import type { Data } from "@opencode/client/solid"
import { normalizeAgentList, normalizeProviderList } from "./utils"
import { ProjectState, VcsState } from "../persistence"

type ChildHandle = {
  store: [Store<State>, SetStoreFunction<State>]
  setMeta: SetStoreFunction<typeof ProjectState.Type>
}

export function createChildStoreManager(input: {
  owner: Owner
  scope: ServerScope
  persist: typeof persisted
  translate: (key: string, vars?: Record<string, string | number>) => string
  data: Data
  global: {
    path: Path
  }
}) {
  // Read only by `dispatch`; no reader tracks the cache, so a reactive memo that accesses a directory never re-runs.
  let cache = createDirectoryCacheState()
  const handles = new Map<DirectoryKey, ChildHandle>()
  const ownerPins = new WeakMap<Owner, Set<string>>()

  function dispatch(event: DirectoryCacheEvent) {
    const result = transitionDirectoryCache(cache, event)

    result.effects.forEach((effect) => {
      if (effect.type === "evict") return handles.delete(effect.key)
      handles.set(effect.key, createHandle(effect.key, effect.directory))
    })
    // Committed after the effects, so a store that failed to build is built again on the next access.
    cache = result.state
  }

  function access(directory: string, pin: boolean) {
    const key = directoryKey(directory)

    if (!key) console.error("No directory provided")
    dispatch({ type: "accessed", key, directory, pin, at: Date.now() })
    const handle = handles.get(key)

    if (!handle) throw new Error(input.translate("error.childStore.storeCreateFailed"))

    return handle
  }

  // Pins the directory once per reactive computation, until that computation re-runs or is disposed.
  function claimForOwner(key: DirectoryKey) {
    const owner = getOwner()

    if (!owner || owner === input.owner) return false
    const set = ownerPins.get(owner)

    if (set?.has(key)) return false

    if (set) set.add(key)

    if (!set) ownerPins.set(owner, new Set([key]))
    onCleanup(() => {
      const set = ownerPins.get(owner)

      if (set) {
        set.delete(key)

        if (set.size === 0) ownerPins.delete(owner)
      }

      // A re-running memo cleans up before it pins its directories again. Releasing at once lets
      // eviction drop them mid-run, so the memo recreates them, and their hydration re-runs it.
      queueMicrotask(() => dispatch({ type: "released", key, at: Date.now() }))
    })

    return true
  }

  function createHandle(key: DirectoryKey, directory: string): ChildHandle {
    const vcs = runWithOwner(input.owner, () =>
      input.persist(Persist.serverWorkspace(input.scope, directory, "vcs"), VcsState, { value: undefined }),
    )

    if (!vcs) throw new Error(input.translate("error.childStore.persistedCacheCreateFailed"))
    const vcsStore = vcs[0]

    const meta = runWithOwner(input.owner, () =>
      input.persist(Persist.serverWorkspace(input.scope, directory, "project"), ProjectState, { value: undefined }),
    )

    if (!meta) throw new Error(input.translate("error.childStore.persistedProjectMetadataCreateFailed"))
    const initialMeta = meta[0].value

    const child = createStore<State>({
      project: "",
      projectMeta: initialMeta,
      get provider_ready() {
        return (
          input.data.location.provider.list({ directory }) !== undefined &&
          input.data.location.model.list({ directory }) !== undefined
        )
      },
      get provider() {
        const provider = input.data.location.provider.list({ directory })
        const model = input.data.location.model.list({ directory })

        if (!provider || !model) return { all: new Map(), connected: [], default: {} }

        return normalizeProviderList(provider, model)
      },
      config: {},
      get path() {
        const location = input.data.location.info({ directory })

        return {
          state: "",
          config: "",
          worktree: location?.project.directory ?? "",
          directory: location?.directory ?? directory,
          home: input.global.path.home,
        }
      },
      get agent() {
        return normalizeAgentList(input.data.location.agent.list({ directory }) ?? [])
      },
      get command() {
        return input.data.location.command.list({ directory }) ?? []
      },
      get reference() {
        return input.data.location.reference.list({ directory }) ?? []
      },
      get mcp_ready() {
        return input.data.location.mcp.server.list({ directory }) !== undefined
      },
      get mcp() {
        return Object.fromEntries(
          (input.data.location.mcp.server.list({ directory }) ?? []).map((server) => [server.name, server.status]),
        )
      },
      get mcp_resource() {
        return Object.fromEntries(
          (input.data.location.mcp.resource.list({ directory }) ?? []).map((resource) => [
            `${resource.server}:${resource.uri}`,
            resource,
          ]),
        )
      },
      get vcs() {
        const vcs = input.data.location.vcs.info({ directory })

        if (!vcs) return vcsStore.value

        return { branch: vcs.branch.current, default_branch: vcs.branch.default }
      },
    })

    const onPersistedInit = (init: Promise<string | null> | string | null, run: () => void) => {
      if (!(init instanceof Promise)) return
      void init.then(() => {
        if (handles.get(key)?.store !== child) return
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

    return { store: child, setMeta: meta[1] }
  }

  function child(directory: string) {
    return access(directory, claimForOwner(directoryKey(directory))).store
  }

  function projectMeta(directory: string, patch: ProjectMeta) {
    const handle = access(directory, false)
    const previous = handle.store[0].projectMeta ?? {}
    const icon = patch.icon ? { ...previous.icon, ...patch.icon } : previous.icon
    const commands = patch.commands ? { ...previous.commands, ...patch.commands } : previous.commands

    const next = {
      ...previous,
      ...patch,
      icon,
      commands,
    }

    handle.setMeta("value", next)
    handle.store[1]("projectMeta", next)
  }

  return {
    child,
    projectMeta,
  }
}
