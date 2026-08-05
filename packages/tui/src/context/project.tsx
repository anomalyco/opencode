import { batch } from "solid-js"
import type { Path } from "@opencode-ai/sdk/v2"
import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

export const { use: useProject, provider: ProjectProvider } = createSimpleContext({
  name: "Project",
  init: () => {
    const sdk = useSDK()

    const defaultPath = {
      home: "",
      state: "",
      config: "",
      worktree: "",
      directory: sdk.directory ?? "",
    } satisfies Path

    const [store, setStore] = createStore({
      project: {
        id: undefined as string | undefined,
        worktree: undefined as string | undefined,
        mainDir: undefined as string | undefined,
      },
      instance: {
        path: defaultPath,
      },
    })

    async function sync() {
      const [instancePath, project] = await Promise.all([
        sdk.client.path.get(),
        sdk.client.project.current(),
      ])
      const directories = project.data?.id
        ? await sdk.client.project.directories({ projectID: project.data.id })
        : undefined
      batch(() => {
        setStore("instance", "path", reconcile(instancePath.data || defaultPath))
        setStore("project", "id", project.data?.id)
        setStore("project", "worktree", project.data?.worktree)
        setStore("project", "mainDir", directories?.data?.findLast((item) => item.strategy === undefined)?.directory)
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
      sync,
    }
  },
})
