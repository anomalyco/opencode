import { createSimpleContext } from "@opencode-ai/ui/context"
import { useParams } from "@solidjs/router"
import { createEffect, createMemo } from "solid-js"
import { useLanguage } from "./language"
import { useLayout } from "./layout"
import { useServerSDK } from "./server-sdk"
import { useServer } from "./server"
import { createFileTreeStore } from "./file/tree-store"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { decode64 } from "@/utils/base64"
import { showToast } from "@/utils/toast"

export type ExplorerTree = {
  list: (path: string) => Promise<void>
  refresh: (path: string) => Promise<void>
  state: (path: string) => { expanded?: boolean; loaded?: boolean; loading?: boolean } | undefined
  children: (path: string) => readonly FileNode[]
  expand: (path: string, behavior?: { list?: boolean }) => void
  collapse: (path: string) => void
  toggle: (path: string) => void
}

const normalizeDir = (input: string) =>
  input
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")

export const { use: useExplorer, provider: ExplorerProvider } = createSimpleContext({
  name: "Explorer",
  init: () => {
    const params = useParams()
    const serverSDK = useServerSDK()
    const server = useServer()
    const layout = useLayout()
    const language = useLanguage()

    const routeDir = createMemo(() => {
      const slug = params.dir
      if (!slug) return
      return decode64(slug)
    })

    const directory = createMemo(() => {
      const routed = routeDir()
      if (routed) return routed
      const last = server.projects.last()
      if (last) return last
      return layout.projects.list()[0]?.worktree
    })

    const client = createMemo(() => {
      const dir = directory()
      if (!dir) return
      return serverSDK().createClient({ directory: dir, throwOnError: true })
    })

    const tree = createFileTreeStore({
      scope: directory,
      normalizeDir,
      list: (path) => {
        const c = client()
        if (!c) return Promise.resolve([])
        return c.file.list({ path }).then((x) => x.data ?? [])
      },
      onError: (message) => {
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description: message,
        })
      },
    })

    createEffect(() => {
      directory()
      tree.reset()
    })

    return {
      directory,
      tree: {
        list: tree.listDir,
        refresh: (path: string) => tree.listDir(path, { force: true }),
        state: tree.dirState,
        children: tree.children,
        expand: tree.expandDir,
        collapse: tree.collapseDir,
        toggle(path: string) {
          if (tree.dirState(path)?.expanded) {
            tree.collapseDir(path)
            return
          }
          tree.expandDir(path)
        },
      } satisfies ExplorerTree,
    }
  },
})
