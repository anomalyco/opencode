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
  init: (props: { defaultUrl: string; forceUrl?: boolean }) => {
    const platform = usePlatform()
    const fallback = () => normalizeServerUrl(props.defaultUrl)
    const [forced, setForced] = createSignal(props.forceUrl ?? false)

    const [store, setStore, _, ready] = persisted(
      "server.v2",
      createStore({
        list: [] as string[],
        active: "",
        projects: {} as Record<string, StoredProject[]>,
      }),
    )

    function setActive(input: string) {
      const url = normalizeServerUrl(input)
      if (!url) return
      batch(() => {
        if (!store.list.includes(url)) {
          setStore("list", (list) => [url, ...list])
        }
        setStore("active", url)
      })
    }

    function remove(input: string) {
      const url = normalizeServerUrl(input)
      if (!url) return

      const list = store.list.filter((x) => x !== url)
      const next = store.active === url ? (list[0] ?? fallback() ?? "") : store.active

      batch(() => {
        setStore("list", list)
        setStore("active", next)
      })
    }

    createEffect(() => {
      if (!ready()) return

      const url = fallback()
      if (!url) return

      if (forced()) {
        batch(() => {
          if (!store.list.includes(url)) {
            setStore("list", (list) => [url, ...list])
          }
          if (store.active !== url) {
            setStore("active", url)
          }
        })
        setForced(false)
        return
      }

      if (store.list.length === 0) {
        batch(() => {
          setStore("list", [url])
          setStore("active", url)
        })
        return
      }

      if (store.active && store.list.includes(store.active)) return
      setStore("active", store.list[0])
    })

    const isReady = createMemo(() => ready() && !!store.active)

    const [healthy, { refetch }] = createResource(
      () => store.active || undefined,
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
      if (!store.active) return
      const interval = setInterval(() => refetch(), 10_000)
      onCleanup(() => clearInterval(interval))
    })

    const projectsList = createMemo(() => store.projects[store.active] ?? [])

    return {
      ready: isReady,
      healthy,
      get url() {
        return store.active
      },
      get name() {
        return serverDisplayName(store.active)
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
          const url = store.active
          if (!url) return
          const current = store.projects[url] ?? []
          if (current.find((x) => x.worktree === directory)) return
          setStore("projects", url, [{ worktree: directory, expanded: true }, ...current])
        },
        close(directory: string) {
          const url = store.active
          if (!url) return
          const current = store.projects[url] ?? []
          setStore(
            "projects",
            url,
            current.filter((x) => x.worktree !== directory),
          )
        },
        expand(directory: string) {
          const url = store.active
          if (!url) return
          const current = store.projects[url] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", url, index, "expanded", true)
        },
        collapse(directory: string) {
          const url = store.active
          if (!url) return
          const current = store.projects[url] ?? []
          const index = current.findIndex((x) => x.worktree === directory)
          if (index !== -1) setStore("projects", url, index, "expanded", false)
        },
        move(directory: string, toIndex: number) {
          const url = store.active
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
