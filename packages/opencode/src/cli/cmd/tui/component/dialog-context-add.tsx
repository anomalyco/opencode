import { useDialog } from "@tui/ui/dialog"
import { DialogMultiField } from "@tui/ui/dialog-multi-field"
import { useToast } from "@tui/ui/toast"

export function DialogContextAdd(props: { onConfirm: (name: string, content: string) => void }) {
  const dialog = useDialog()
  const toast = useToast()

  return (
    <DialogMultiField
      title="Create Context"
      fields={[
        {
          name: "name",
          label: "Name",
          placeholder: "e.g., API_DOCS, DATABASE_SCHEMA, REQUIREMENTS",
          value: "",
          required: true,
        },
        {
          name: "content",
          label: "Content",
          placeholder: "URLs, @file references, or text to include in messages",
          value: "",
          required: false,
        },
      ]}
      onConfirm={async (values) => {
        if (!values.name?.trim()) {
          toast.show({
            variant: "error",
            message: "Context name is required",
          })
          return
        }

        props.onConfirm(values.name.trim(), values.content?.trim() || "")
        toast.show({
          variant: "success",
          message: `Created context: ${values.name.trim()}`,
        })
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
