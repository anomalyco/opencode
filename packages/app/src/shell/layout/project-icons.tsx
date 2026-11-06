import { ProjectIconStoreProvider, type GeneratedProjectIcon } from "@opencode/ui/project-avatar"
import { Schema } from "effect"
import type { ParentProps } from "solid-js"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"

const ProjectIconState = Persistence.struct({
  icons: Persistence.record(
    Persistence.struct({
      style: Schema.String,
      version: Schema.Finite,
      params: Schema.Record(Schema.String, Schema.Finite),
    }),
  ),
})

// Generated default avatars are kept on this client, keyed by the project ID (or the directory for projects without
// one), so each icon stays identical after restarts and after the generator's defaults change. Project IDs derive from
// the repository, so the same repository shows the same icon on every server.
export function ProjectIconsProvider(props: ParentProps) {
  const [store, setStore] = persisted(Persist.global("project-icons"), ProjectIconState, { icons: {} })

  return (
    <ProjectIconStoreProvider
      value={{
        get: (key) => store.icons[key],
        remember: (key: string, icon: GeneratedProjectIcon) =>
          setStore("icons", key, { style: icon.style, version: icon.version, params: { ...icon.params } }),
      }}
    >
      {props.children}
    </ProjectIconStoreProvider>
  )
}
