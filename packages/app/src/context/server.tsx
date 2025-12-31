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
          if (current.find((x) => x.worktree === directory)) return
          setStore("projects", key, [{ worktree: directory, expanded: true }, ...current])
        },
        close(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          setStore(
            "projects",
            key,
            current.filter((x) => x.worktree !== directory),
          )
        },
        expand(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", true)
        },
        collapse(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", key, index, "expanded", false)
        },
        move(directory: string, toIndex: number) {
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
      },
    }
  },
})
