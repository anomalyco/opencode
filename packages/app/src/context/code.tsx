import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { useExplorer } from "./explorer"
import { useServerSDK } from "./server-sdk"
import { Persist, persisted } from "@/utils/persist"
import type { FileContent } from "@opencode-ai/sdk/v2"

export type CodeTab = {
  path: string
}

type CodeState = {
  tabs: CodeTab[]
  active: string | undefined
}

const migrate = (value: unknown): CodeState => {
  if (!value || typeof value !== "object") return { tabs: [], active: undefined }
  const item = value as { tabs?: unknown; active?: unknown }
  const tabs = Array.isArray(item.tabs)
    ? item.tabs
        .filter((tab): tab is CodeTab => typeof tab === "object" && tab !== null && typeof tab.path === "string")
        .map((tab) => ({ path: tab.path }))
    : []
  return {
    tabs,
    active: typeof item.active === "string" && tabs.some((tab) => tab.path === item.active) ? item.active : tabs[0]?.path,
  }
}

export const { use: useCode, provider: CodeProvider } = createSimpleContext({
  name: "Code",
  init: () => {
    const explorer = useExplorer()
    const serverSDK = useServerSDK()

    const directory = createMemo(() => explorer.directory())

    const [saved, setSaved, , ready] = persisted(
      { ...Persist.global("code-tabs", ["code-tabs.v1"]), migrate },
      createStore<CodeState>({ tabs: [], active: undefined }),
    )

    const [content, setContent] = createStore<Record<string, { status: "loading" | "ready" | "error"; data?: FileContent }>>({})

    const load = (path: string) => {
      const dir = directory()
      if (!dir) return
      const current = content[path]
      if (current?.status === "ready" || current?.status === "loading") return
      setContent(path, { status: "loading" })
      serverSDK()
        .createClient({ directory: dir, throwOnError: true })
        .file.read({ path })
        .then((x) => {
          if (!x.data) {
            setContent(path, { status: "error" })
            return
          }
          setContent(path, { status: "ready", data: x.data })
        })
        .catch(() => {
          setContent(path, { status: "error" })
        })
    }

    const open = (path: string) => {
      if (!path) return
      const tabs = saved.tabs
      if (tabs.some((tab) => tab.path === path)) {
        setSaved("active", path)
        load(path)
        return
      }
      setSaved("tabs", [...tabs, { path }])
      setSaved("active", path)
      load(path)
    }

    const close = (path: string) => {
      const tabs = saved.tabs
      const index = tabs.findIndex((tab) => tab.path === path)
      if (index === -1) return
      const next = tabs.filter((tab) => tab.path !== path)
      setSaved("tabs", reconcile(next))
      setContent(
        produce((draft) => {
          delete draft[path]
        }),
      )
      if (saved.active !== path) return
      const fallback = next[index - 1] ?? next[index] ?? next[0]
      setSaved("active", fallback?.path)
    }

    const setActive = (path: string) => {
      if (!saved.tabs.some((tab) => tab.path === path)) return
      setSaved("active", path)
      load(path)
    }

    const clear = () => {
      setSaved("tabs", reconcile([]))
      setSaved("active", undefined)
      setContent({}, reconcile({}))
    }

    const readFile = (path: string) => {
      const dir = directory()
      if (!dir) return Promise.resolve(undefined)
      return serverSDK()
        .createClient({ directory: dir, throwOnError: true })
        .file.read({ path })
        .then((x) => x.data)
    }

    return {
      ready,
      directory,
      tabs: () => saved.tabs,
      active: () => saved.active,
      content: (path: string) => content[path],
      open,
      close,
      setActive,
      clear,
      load,
      readFile,
      tabKey: (path: string) => `file://${base64Encode(path)}`,
      label: (path: string) => getFilename(path),
    }
  },
})
