import { DialogSelect } from "@tui/ui/dialog-select"

export function DialogGitLabWorkflowModel(props: {
  requestID: string
  models: { name: string; ref: string; isDefault?: boolean }[]
  onReply: (modelRef: string | null) => void
}) {
  const options = () =>
    props.models.map((m) => ({
      title: m.isDefault ? `${m.name} (default)` : m.name,
      value: m.ref,
      onSelect: () => {
        props.onReply(m.ref)
      },
    }))

  return <DialogSelect<string> options={options()} title="Select GitLab workflow model" />
}
