import { batch } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"

export const { use: useProject, provider: ProjectProvider } = createSimpleContext({
  name: "Project",
  init: () => {
    const client = useClient()

    const defaultPath = {
      home: "",
      state: "",
      config: "",
      worktree: "",
      directory: process.cwd(),
    }

    const [store, setStore] = createStore({
      project: {
        id: undefined as string | undefined,
        worktree: undefined as string | undefined,
        mainDir: undefined as string | undefined,
      },
      instance: {
        path: defaultPath,
      },
      workspace: {
        current: undefined as string | undefined,
      },
    })

    async function sync() {
      const workspace = store.workspace.current
      const location = { workspace }
      const current = await client.api.location.get({ location })
      const directories = await client.api.project.directories({ projectID: current.project.id, location })
      batch(() => {
        setStore(
          "instance",
          "path",
          reconcile({ ...defaultPath, worktree: current.project.directory, directory: current.directory }),
        )
        setStore("project", "id", current.project.id)
        setStore("project", "worktree", current.project.directory)
        setStore("project", "mainDir", directories.findLast((item) => item.strategy === undefined)?.directory)
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
          return store.workspace.current
        },
        set(next?: string | null) {
          const workspace = next ?? undefined
          if (store.workspace.current === workspace) return
          setStore("workspace", "current", workspace)
        },
      },
      sync,
    }
  },
})
