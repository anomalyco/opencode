import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { persisted } from "@/utils/persist"

type StoredProject = { worktree: string; expanded: boolean }

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  const cleaned = withProtocol.replace(/\/+$/, "")
  return cleaned.replace(/^(https?:\/\/[^/]+).*/, "$1")
}

export function serverDisplayName(url: string) {
  if (!url) return ""
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .split("/")[0]
}

function projectsKey(url: string) {
  if (!url) return ""
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
  return url
}

/**
 * Check if the current platform is Windows.
 * Windows paths are case-insensitive, so we need special handling.
 */
function isWindows(): boolean {
  return typeof navigator !== "undefined" && navigator.platform?.toLowerCase().includes("win")
}

/**
 * Compare two file paths for equality.
 * On Windows, paths are compared case-insensitively.
 * On other platforms, paths are compared case-sensitively.
 */
function pathsEqual(path1: string, path2: string): boolean {
  if (isWindows()) {
    return path1.toLowerCase() === path2.toLowerCase()
  }
  return path1 === path2
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: { defaultUrl: string }) => {
    const platform = usePlatform()

    const [store, setStore, _, ready] = persisted(
      "server.v3",
      createStore({
        list: [] as string[],
        projects: {} as Record<string, StoredProject[]>,
      }),
    )

    const [active, setActiveRaw] = createSignal("")

    function setActive(input: string) {
      const url = normalizeServerUrl(input)
      if (!url) return
      setActiveRaw(url)
    }

    function add(input: string) {
      const url = normalizeServerUrl(input)
      if (!url) return

      const fallback = normalizeServerUrl(props.defaultUrl)
      if (fallback && url === fallback) {
        setActiveRaw(url)
        return
      }

      batch(() => {
        if (!store.list.includes(url)) {
          setStore("list", store.list.length, url)
        }
        setActiveRaw(url)
      })
    }

    function remove(input: string) {
      const url = normalizeServerUrl(input)
      if (!url) return

      const list = store.list.filter((x) => x !== url)
      const next = active() === url ? (list[0] ?? normalizeServerUrl(props.defaultUrl) ?? "") : active()

      batch(() => {
        setStore("list", list)
        setActiveRaw(next)
      })
    }

    createEffect(() => {
      if (!ready()) return
      if (active()) return
      const url = normalizeServerUrl(props.defaultUrl)
      if (!url) return
      setActiveRaw(url)
    })

    const isReady = createMemo(() => ready() && !!active())

    const [healthy, { refetch }] = createResource(
      () => active() || undefined,
      async (url) => {
        if (!url) return

        const sdk = createOpencodeClient({
          baseUrl: url,
          fetch: platform.fetch,
          signal: AbortSignal.timeout(2000),
        })
        return sdk.global
          .health()
          .then((x) => x.data?.healthy === true)
          .catch(() => false)
      },
    )

    createEffect(() => {
      if (!active()) return
      const interval = setInterval(() => refetch(), 10_000)
      onCleanup(() => clearInterval(interval))
    })

    const origin = createMemo(() => projectsKey(active()))
    const projectsList = createMemo(() => store.projects[origin()] ?? [])
    const isLocal = createMemo(() => origin() === "local")

    return {
      ready: isReady,
      healthy,
      isLocal,
      get url() {
        return active()
      },
      get name() {
        return serverDisplayName(active())
      },
      get list() {
        return store.list
      },
      setActive,
      add,
      remove,
      projects: {
        list: projectsList,
        open(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          // Use case-insensitive comparison on Windows to prevent duplicate entries
          if (current.find((x) => pathsEqual(x.worktree, directory))) return
          setStore("projects", key, [{ worktree: directory, expanded: true }, ...current])
        },
        close(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          setStore(
            "projects",
            key,
            // Use case-insensitive comparison on Windows
            current.filter((x) => !pathsEqual(x.worktree, directory)),
          )
        },
        expand(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          // Use case-insensitive comparison on Windows
          const index = current.findIndex((x) => pathsEqual(x.worktree, directory))
          if (index !== -1) setStore("projects", key, index, "expanded", true)
        },
        collapse(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          // Use case-insensitive comparison on Windows
          const index = current.findIndex((x) => pathsEqual(x.worktree, directory))
          if (index !== -1) setStore("projects", key, index, "expanded", false)
        },
        move(directory: string, toIndex: number) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          // Use case-insensitive comparison on Windows
          const fromIndex = current.findIndex((x) => pathsEqual(x.worktree, directory))
          if (fromIndex === -1 || fromIndex === toIndex) return
          const result = [...current]
          const [item] = result.splice(fromIndex, 1)
          result.splice(toIndex, 0, item)
          setStore("projects", key, result)
        },
      },
    }
  },
})
