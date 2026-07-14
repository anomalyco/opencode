import { createMemo, createResource } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useProject } from "../context/project"
import { useClient } from "../context/client"
import { createStore } from "solid-js/store"

export function DialogTag(props: { onSelect?: (value: string) => void }) {
  const client = useClient()
  const dialog = useDialog()
  const project = useProject()

  const [store] = createStore({
    filter: "",
  })

  const [files] = createResource(
    () => [store.filter],
    async () => {
      const result = await client.api.file
        .find({
          query: store.filter,
          type: "file",
          limit: 5,
          location: { workspace: project.workspace.current() },
        })
        .catch(() => undefined)
      return result?.data.map((item) => item.path) ?? []
    },
  )

  const options = createMemo(() =>
    (files() ?? []).map((file) => ({
      value: file,
      title: file,
    })),
  )

  return (
    <DialogSelect
      title="Autocomplete"
      options={options()}
      onSelect={(option) => {
        props.onSelect?.(option.value)
        dialog.clear()
      }}
    />
  )
}
