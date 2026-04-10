import { batch } from "solid-js"
import type { Path } from "@opencode-ai/sdk"
import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

export const { use: useProject, provider: ProjectProvider } = createSimpleContext({
  name: "Project",
  init: () => {
    const sdk = useSDK()
    const [store, setStore] = createStore({
      project: {
        id: undefined as string | undefined,
      },
      instance: {
        path: {
          state: "",
          config: "",
          worktree: "",
          directory: sdk.directory ?? "",
        } satisfies Path,
      },
      workspace: undefined as string | undefined,
    })

    async function sync() {
      const workspace = store.workspace
      const [path, project] = await Promise.all([
        sdk.client.path.get({ workspace }),
        sdk.client.project.current({ workspace }),
      ])

      batch(() => {
        setStore("instance", "path", reconcile(path.data!))
        setStore("project", "id", project.data?.id)
      })
    }

    return {
      data: store,
      project() {
        return store.project.id
      },
      instance: {
        path() {
          return store.instance.path
        },
        directory() {
          return store.instance.path.directory
        },
      },
      workspace: {
        current() {
          return store.workspace
        },
        set(next?: string | null) {
          const workspace = next ?? undefined
          if (store.workspace === workspace) return
          setStore("workspace", workspace)
        },
      },
      sync,
    }
  },
})
