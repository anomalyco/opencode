import { batch, createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useProject } from "./project"

export type SkillInfo = {
  name: string
  description: string
  content: string
  location: string
}

export const { use: useSkillCatalog, provider: SkillCatalogProvider } = createSimpleContext({
  name: "SkillCatalog",
  init: () => {
    const sdk = useSDK()
    const project = useProject()
    const [store, setStore] = createStore({
      loading: false,
      workspace: undefined as string | undefined,
      skills: [] as SkillInfo[],
    })

    const requests = new Map<string, Promise<SkillInfo[]>>()
    const cache = new Map<string, SkillInfo[]>()

    function key(workspace: string | undefined) {
      return workspace ?? ""
    }

    function sync(workspace: string | undefined, skills: SkillInfo[]) {
      if (project.workspace.current() !== workspace) return
      batch(() => {
        setStore("workspace", workspace)
        setStore("skills", skills)
      })
    }

    const load = async (opts?: { refresh?: boolean }) => {
      const workspace = project.workspace.current()
      const id = key(workspace)
      const request = requests.get(id)
      if (request) return request

      const cached = cache.get(id)
      if (cached && !opts?.refresh) {
        sync(workspace, cached)
        return cached
      }

      batch(() => {
        setStore("workspace", workspace)
        setStore("loading", true)
        setStore("skills", cached ?? [])
      })

      const next = sdk.client.app
        .skills({ workspace })
        .then((result) => result.data ?? [])
        .then((skills) => {
          cache.set(id, skills)
          sync(workspace, skills)
          return skills
        })
        .catch(() => {
          const fallback = cache.get(id) ?? (store.workspace === workspace ? store.skills : [])
          sync(workspace, fallback)
          return fallback
        })
        .finally(() => {
          requests.delete(id)
          if (project.workspace.current() !== workspace) return
          setStore("loading", false)
        })

      requests.set(id, next)
      return next
    }

    const refresh = () => load({ refresh: true })

    createEffect(
      on(
        () => project.workspace.current(),
        () => {
          void refresh()
        },
        { defer: true },
      ),
    )

    void load()

    return {
      data: store,
      load,
      refresh,
      loading() {
        return store.loading
      },
      skills() {
        return store.skills
      },
      get(name: string) {
        return store.skills.find((skill) => skill.name === name)
      },
    }
  },
})
