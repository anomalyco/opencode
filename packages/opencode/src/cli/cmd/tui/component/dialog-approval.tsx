import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"

type ApprovalMode = "allow" | "ask" | "reject"

type ApprovalOption = {
  title: string
  value: ApprovalMode
  description: string
}

const options: ApprovalOption[] = [
  {
    title: "Allow",
    value: "allow",
    description: "Auto-approve tools",
  },
  {
    title: "Ask",
    value: "ask",
    description: "Ask for each tool",
  },
  {
    title: "Reject",
    value: "reject",
    description: "Deny all tools",
  },
]

export function DialogApproval(props: { sessionID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()

  const apply = (mode: ApprovalMode) => {
    const action = mode === "reject" ? "deny" : mode
    sdk.client.session
      .update({
        sessionID: props.sessionID,
        permission: [{ permission: "*", pattern: "*", action }],
      })
      .then(() => {
        dialog.clear()
        toast.show({
          variant: "success",
          message: `Approval mode: ${mode}`,
        })
      })
      .catch(() => {
        toast.show({
          variant: "error",
          message: "Failed to update approvals",
        })
      })
  }

  return <DialogSelect title="Approval mode" options={options} onSelect={(option) => apply(option.value)} />
}
