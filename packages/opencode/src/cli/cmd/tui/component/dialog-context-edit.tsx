import { useDialog } from "@tui/ui/dialog"
import { DialogMultiField } from "@tui/ui/dialog-multi-field"
import { useToast } from "@tui/ui/toast"

export function DialogContextEdit(props: { name: string; content: string; onConfirm: (content: string) => void }) {
  const dialog = useDialog()
  const toast = useToast()

  return (
    <DialogMultiField
      title={`Edit Content: ${props.name}`}
      fields={[
        {
          name: "content",
          label: "Content",
          placeholder: "URLs, @file references, or text to include in messages",
          value: props.content,
          required: false,
        },
      ]}
      onConfirm={async (values) => {
        props.onConfirm(values.content?.trim() || "")
        toast.show({
          variant: "success",
          message: `Updated ${props.name}`,
        })
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
