import { Binary } from "@opencode-ai/core/util/binary"
import { produce, type SetStoreFunction, type Store } from "solid-js/store"
import type { Project } from "@/types"
import type { State, VcsCache } from "./types"

export function applyGlobalEvent(input: {
  event: { type: string; properties?: unknown }
  project: Project[]
  setGlobalProject: (next: Project[] | ((draft: Project[]) => Project[])) => void
  refresh: () => void
}) {
  if (input.event.type === "global.disposed") {
    input.refresh()
    return
  }
  if (input.event.type !== "project.updated") return
  const properties = input.event.properties as Project
  const result = Binary.search(input.project, properties.id, (project) => project.id)
  if (result.found) {
    input.setGlobalProject(
      produce((draft) => {
        draft[result.index] = { ...draft[result.index], ...properties }
      }),
    )
    return
  }
  input.setGlobalProject(
    produce((draft) => {
      draft.splice(result.index, 0, properties)
    }),
  )
}

export function applyDirectoryEvent(input: {
  event: { type: string; properties?: unknown }
  store: Store<State>
  setStore: SetStoreFunction<State>
  push: (directory: string) => void
  directory: string
  loadLsp: () => void
  loadReferences?: () => void
  vcsCache?: VcsCache
}) {
  switch (input.event.type) {
    case "server.instance.disposed":
      input.push(input.directory)
      break
    case "vcs.branch.updated": {
      const properties = input.event.properties as { branch?: string }
      if (input.store.vcs?.branch === properties.branch) break
      const next = { ...input.store.vcs, branch: properties.branch }
      input.setStore("vcs", next)
      input.vcsCache?.setStore("value", next)
      break
    }
    case "lsp.updated":
      input.loadLsp()
      break
    case "reference.updated":
      input.loadReferences?.()
      break
  }
}
