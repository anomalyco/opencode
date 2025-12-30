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
      const url = normalizeServerUrl(props.defaultUrl)
      if (!url) return

      batch(() => {
        if (!store.list.includes(url)) {
          setStore("list", store.list.length, url)
        }
        setActiveRaw(url)
      })
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

    const projectsList = createMemo(() => store.projects[active()] ?? [])

    return {
      ready: isReady,
      healthy,
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
      add: setActive,
      remove,
      projects: {
        list: projectsList,
        open(directory: string) {
          const url = active()
          if (!url) return
          const current = store.projects[url] ?? []
          if (current.find((x) => x.worktree === directory)) return
          setStore("projects", url, [{ worktree: directory, expanded: true }, ...current])
        },
        close(directory: string) {
          const url = active()
          if (!url) return
          const current = store.projects[url] ?? []
          setStore(
            "projects",
            url,
            current.filter((x) => x.worktree !== directory),
          )
        },
        expand(directory: string) {
          const url = active()
          if (!url) return
          const current = store.projects[url] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", url, index, "expanded", true)
        },
        collapse(directory: string) {
          const url = active()
          if (!url) return
          const current = store.projects[url] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", url, index, "expanded", false)
        },
        move(directory: string, toIndex: number) {
          const url = active()
          if (!url) return
          const current = store.projects[url] ?? []
          const fromIndex = current.findIndex((x) => x.worktree === directory)
          if (fromIndex === -1 || fromIndex === toIndex) return
          const result = [...current]
          const [item] = result.splice(fromIndex, 1)
          result.splice(toIndex, 0, item)
          setStore("projects", url, result)
        },
      },
    }
  },
})
