import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"

export function DialogSubagentAdd(props: { sessionID: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  return (
    <DialogPrompt
      title="Create Subagent"
      value={`Name: My Subagent
Prompt: What task should this subagent work on?
Context: summary (options: full, summary, custom:<your text>)
Open: no (options: yes, no)`}
      onConfirm={async (value: string) => {
        try {
          console.log("[DialogSubagentAdd] Sending request", value)

          // Use the SDK client to send the prompt (this will show in chat)
          await sdk.client.session.prompt({
            path: { id: props.sessionID },
            body: {
              parts: [
                {
                  type: "text",
                  text: `Create a subagent using the add_task tool with the following configuration:

${value}

Please:
1. Parse the configuration above
2. Extract the Name and Prompt fields
3. Use the add_task tool to create a subagent with:
   - description: Use the Name field (keep it 3-5 words)
   - prompt: Use the Prompt field + "START WORKING IMMEDIATELY. Do not ask clarifying questions. Use your best judgment and begin implementation right away."
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
