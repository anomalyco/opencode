import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { createResource } from "solid-js"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"

export function DialogProjectMemory() {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()

  const [project] = createResource(async () => {
    const response = await sdk.client.project.current()
    return response.data
  })

  return (
    <DialogPrompt
      title="Project Memory"
      description={() => (
        <text fg={theme.textMuted}>
          Persistent context included in all sessions for this project.
        </text>
      )}
      value={project()?.memory ?? ""}
      onConfirm={async (value) => {
        const proj = project()
        if (!proj) {
          toast.show({ message: "No project found", variant: "error" })
          dialog.clear()
          return
        }
        await sdk.client.project.update({
          projectID: proj.id,
          memory: value || undefined,
        })
        toast.show({ message: "Project memory updated", variant: "success" })
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
