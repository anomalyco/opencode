import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { Persist, persisted } from "@/utils/persist"
import { validWorktree } from "@claxedo/utils/worktree"
import { getExtensions } from "@opencode-ai/app-shared"

type StoredProject = { worktree: string; expanded: boolean }
type WorkspaceServerMap = Record<string, string>

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function serverDisplayName(url: string) {
  if (!url) return ""
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

function projectsKey(url: string) {
  if (!url) return ""
  try {
    const u = new URL(url)
    const host = u.hostname
    // Treat session-scoped gateway URLs as distinct "servers" even if they're on localhost,
    // otherwise cloud sandboxes collapse into the same "local" bucket and reloads revert to :3000.
    if ((host === "localhost" || host === "127.0.0.1") && u.pathname.startsWith("/s/")) {
      return url
    }
    if (host === "localhost" || host === "127.0.0.1") return "local"
  } catch {
    // fall through
  }
  return url
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: { defaultUrl: string }) => {
    const platform = usePlatform()

    const [store, setStore, _, ready] = persisted(
      Persist.global("server", ["server.v5", "server.v4", "server.v3"]),
      createStore({
        list: [] as string[],
        projects: {} as Record<string, StoredProject[]>,
        lastProject: {} as Record<string, string>,
        workspaceServer: {} as WorkspaceServerMap,
        closedProjects: {} as Record<string, string[]>,
      }),
    )

    const [state, setState] = createStore({
      active: "",
      healthy: undefined as boolean | undefined,
    })

    const healthy = () => state.healthy

    const devProxyOrigin = (() => {
      if (!import.meta.env.DEV) return
      const normalized = normalizeServerUrl(props.defaultUrl)
      if (!normalized) return
      try {
        const u = new URL(normalized)
        if (u.protocol !== "http:" && u.protocol !== "https:") return
        return u.origin
      } catch {
        return
      }
    })()

    const rewriteDevPersistedUrl = (input: string | undefined) => {
      const normalized = input ? normalizeServerUrl(input) : undefined
      if (!normalized) return
      if (!import.meta.env.DEV) return normalized
      if (!devProxyOrigin) return normalized

      try {
        const u = new URL(normalized)
        const host = u.hostname
        const port = u.port

        // When the UI is served by Vite (e.g. :4444) we want all browser traffic to be same-origin
        // and let Vite proxy to the real backend (:3000). Old persisted values may point at :3000.
        if ((host === "localhost" || host === "127.0.0.1") && port === "3000") {
          const pathname = u.pathname === "/" ? "" : u.pathname
          return normalizeServerUrl(`${devProxyOrigin}${pathname}${u.search}${u.hash}`) ?? normalized
        }
      } catch {
        // fall through
      }
      return normalized
    }

    function setActive(input: string) {
      const url = normalizeServerUrl(input)
      if (!url) return
      setState("active", url)
    }

    function add(input: string) {
      const url = normalizeServerUrl(input)
      if (!url) return

      const fallback = normalizeServerUrl(props.defaultUrl)
      if (fallback && url === fallback) {
        setState("active", url)
        return
      }

      batch(() => {
        if (!store.list.includes(url)) {
          setStore("list", store.list.length, url)
        }
        setState("active", url)
      })
    }

    function remove(input: string) {
      const url = normalizeServerUrl(input)
      if (!url) return

      const list = store.list.filter((x) => x !== url)
      const next = state.active === url ? (list[0] ?? normalizeServerUrl(props.defaultUrl) ?? "") : state.active

      batch(() => {
        setStore("list", list)
        setState("active", next)
      })
    }

    // One-time dev migration: rewrite persisted localhost:3000 URLs to the current Vite origin
    // so terminal WebSockets and API calls go through the dev proxy (avoids CORS/WS Origin issues).
    createEffect(() => {
      if (!ready()) return
      if (!import.meta.env.DEV) return
      if (!devProxyOrigin) return

      const nextList: string[] = []
      const seen = new Set<string>()
      for (const raw of store.list) {
        const rewritten = rewriteDevPersistedUrl(raw)
        if (!rewritten) continue
        if (seen.has(rewritten)) continue
        seen.add(rewritten)
        nextList.push(rewritten)
      }

      const nextWorkspaceServer: WorkspaceServerMap = {}
      for (const [worktree, url] of Object.entries(store.workspaceServer)) {
        const rewritten = rewriteDevPersistedUrl(url) ?? url
        if (rewritten) nextWorkspaceServer[worktree] = rewritten
      }

      const listChanged =
        nextList.length !== store.list.length || nextList.some((x, i) => x !== store.list[i])
      const workspaceChanged = (() => {
        const currentKeys = Object.keys(store.workspaceServer)
        const nextKeys = Object.keys(nextWorkspaceServer)
        if (currentKeys.length !== nextKeys.length) return true
        for (const k of currentKeys) {
          if (store.workspaceServer[k] !== nextWorkspaceServer[k]) return true
        }
        return false
      })()

      if (!listChanged && !workspaceChanged) return

      batch(() => {
        if (listChanged) setStore("list", nextList)
        if (workspaceChanged) setStore("workspaceServer", nextWorkspaceServer)
      })
    })

    createEffect(() => {
      if (!ready()) return
      if (state.active) return
      const url = normalizeServerUrl(props.defaultUrl)
      if (!url) return
      setState("active", url)
    })

    const isReady = createMemo(() => ready() && !!state.active)

    const check = (url: string) => {
      const signal = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout?.(3000)
      const sdk = createOpencodeClient({
        baseUrl: url,
        fetch: platform.fetch,
        signal,
      })
      return sdk.global
        .health()
        .then((x) => x.data?.healthy === true)
        .catch(() => false)
    }

    createEffect(() => {
      const url = state.active
      if (!url) return

      setState("healthy", undefined)

      let alive = true
      let busy = false

      const run = () => {
        if (busy) return
        busy = true
        void check(url)
          .then((next) => {
            if (!alive) return
            setState("healthy", next)
          })
          .finally(() => {
            busy = false
          })
      }

      run()
      const interval = setInterval(run, 10_000)

      onCleanup(() => {
        alive = false
        clearInterval(interval)
      })
    })

    const origin = createMemo(() => projectsKey(state.active))
    const projectsList = createMemo(() => store.projects[origin()] ?? [])
    const isLocal = createMemo(() => origin() === "local")

    // Extension: Transform URL before returning (canonicalization/gateway rewrite)
    const ext = getExtensions()
    const url = createMemo(() => {
      const raw = state.active
      return ext.server.transformUrl?.(raw) ?? raw
    })

    return {
      ready: isReady,
      healthy,
      isLocal,
      get url() {
        return url()
      },
      get name() {
        return serverDisplayName(state.active)
      },
      get list() {
        return store.list
      },
      forWorkspace(worktree: string) {
        return store.workspaceServer[worktree]
      },
      rememberWorkspace(worktree: string, url: string) {
        const normalized = normalizeServerUrl(url)
        if (!normalized) return
        setStore("workspaceServer", worktree, normalized)
      },
      setActive,
      add,
      remove,
      projects: {
        list: projectsList,
        open(directory: string) {
          if (!validWorktree(directory)) return
          const key = origin()
          if (!key) return
          // Remove from closed list when explicitly opening
          const closed = store.closedProjects[key] ?? []
          if (closed.includes(directory)) {
            setStore("closedProjects", key, closed.filter((x) => x !== directory))
          }
          const current = store.projects[key] ?? []
          if (current.find((x) => x.worktree === directory)) return
          setStore("projects", key, [{ worktree: directory, expanded: true }, ...current])
        },
        close(directory: string) {
          if (!validWorktree(directory)) return
          const key = origin()
          if (!key) return
          // Add to closed list to prevent re-sync from API
          const closed = store.closedProjects[key] ?? []
          if (!closed.includes(directory)) {
            setStore("closedProjects", key, [...closed, directory])
          }
          const current = store.projects[key] ?? []
          setStore(
            "projects",
            key,
            current.filter((x) => x.worktree !== directory),
          )
        },
        remove(directory: string) {
          if (!validWorktree(directory)) return
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          if (!current.some((x) => x.worktree === directory)) return
          setStore(
            "projects",
            key,
            current.filter((x) => x.worktree !== directory),
          )
        },
        isClosed(directory: string) {
          if (!validWorktree(directory)) return false
          const key = origin()
          if (!key) return false
          const closed = store.closedProjects[key] ?? []
          return closed.includes(directory)
        },
        sync(directories: string[]) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const expanded = new Map(current.map((x) => [x.worktree, x.expanded]))
          const seen = new Set<string>()
          const next = directories
            .filter(validWorktree)
            .filter((worktree) => {
              if (seen.has(worktree)) return false
              seen.add(worktree)
              return true
            })
            .map((worktree) => ({ worktree, expanded: expanded.get(worktree) ?? true }))

          setStore("projects", key, next)
        },
        expand(directory: string) {
          if (!validWorktree(directory)) return
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", true)
        },
        collapse(directory: string) {
          if (!validWorktree(directory)) return
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", false)
        },
        move(directory: string, toIndex: number) {
          if (!validWorktree(directory)) return
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const fromIndex = current.findIndex((x) => x.worktree === directory)
          if (fromIndex === -1 || fromIndex === toIndex) return
          const result = [...current]
          const [item] = result.splice(fromIndex, 1)
          result.splice(toIndex, 0, item)
          setStore("projects", key, result)
        },
        last() {
          const key = origin()
          if (!key) return
          return store.lastProject[key]
        },
        touch(directory: string) {
          const key = origin()
          if (!key) return
          setStore("lastProject", key, directory)
        },
      },
    }
  },
})
