import path from "node:path"
import { createResource, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { useSDK } from "../../context/sdk"
import { useProject } from "../../context/project"

export function DialogPreviewFile(props: { directory?: string; workspace?: string; onSelect: (file: string) => void }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const project = useProject()

  const [query, setQuery] = createSignal("")
  const [files] = createResource(
    () => query(),
    async (q) => {
      const result = await sdk.client.v2.fs
        .find({
          query: q,
          limit: "20",
          location: {
            directory: props.directory,
            workspace: props.workspace ?? project.workspace.current(),
          },
        })
        .catch(() => undefined)
      if (!result || result.error || !result.data) return []
      const directory = result.data.location.directory
      return result.data.data
        .filter((item) => item.type === "file")
        .map(
          (item): DialogSelectOption<string> => ({
            title: item.path,
            value: path.join(directory, item.path),
          }),
        )
    },
    { initialValue: [] },
  )

  return (
    <DialogSelect
      title="Preview markdown file"
      placeholder="Search files to preview"
      options={files()}
      skipFilter
      onFilter={setQuery}
      onSelect={(option) => {
        props.onSelect(option.value)
        dialog.clear()
      }}
    />
  )
}
