import { useDialog } from "@tui/ui/dialog"
import { DialogMultiField } from "@tui/ui/dialog-multi-field"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"

export function DialogSubagentAdd(props: { sessionID: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  return (
    <DialogMultiField
      title="Create Subagent"
      fields={[
        {
          name: "name",
          label: "Name (optional - random if empty)",
          placeholder: "My Subagent",
          value: "",
          required: false,
        },
        {
          name: "role",
          label: "Role",
          placeholder: "e.g., Bug Fixer, Feature Developer, Code Reviewer",
          value: "",
          required: true,
        },
        {
          name: "prompt",
          label: "Prompt",
          placeholder: "What task should this subagent work on?",
          value: "",
          required: true,
        },
        {
          name: "context",
          label: "Context",
          placeholder: "summary, full, or custom text",
          value: "summary",
          required: false,
        },
      ]}
      onConfirm={async (values) => {
        try {
          console.log("[DialogSubagentAdd] Creating subagent with values:", values)

          // Use the SDK client to send the prompt (this will show in chat)
          await sdk.client.session.prompt({
            path: { id: props.sessionID },
            body: {
              parts: [
                {
                  type: "text",
                  text: `Create a subagent using the add_task tool with the following configuration:

Name: ${values.name || "(random)"}
Role: ${values.role}
Prompt: ${values.prompt}
Context: ${values.context}

Please:
1. Use the add_task tool to create a subagent with:
   - description: "${values.role}" (keep it 3-5 words)
   - prompt: "${values.prompt}

START WORKING IMMEDIATELY. Do not ask clarifying questions. Use your best judgment and begin implementation right away."
   - subagent_type: "general"

The subagent will receive the prompt and should start work immediately without asking questions. They will use complete_task to report back when done.

Use the add_task tool now.`,
                },
              ],
            },
          })

          console.log("[DialogSubagentAdd] Request sent successfully")

          toast.show({
            variant: "success",
            message: "Subagent creation request sent",
          })

          dialog.clear()
        } catch (error) {
          console.error("[DialogSubagentAdd] Error:", error)
          toast.show({
            variant: "error",
            message: "Error creating subagent",
          })
          dialog.clear()
        }
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
