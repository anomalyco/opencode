import { createMemo } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import type { AuthMethod } from "@agentclientprotocol/sdk"

export type DialogAuthProps = {
  authMethods: AuthMethod[]
  agentName: string
  onSelect: (method: AuthMethod) => void
}

export function DialogAuth(props: DialogAuthProps) {
  const dialog = useDialog()

  const options = createMemo(() => {
    return props.authMethods.map((method) => ({
      value: method.id,
      title: method.name,
      description: method.description ?? undefined,
      onSelect: () => {
        const selected = props.authMethods.find((m) => m.id === method.id)
        if (selected) {
          // Don't clear dialog here - let parent code clear it after auth completes
          props.onSelect(selected)
        }
      },
    }))
  })

  return <DialogSelect title={`Authenticate with ${props.agentName}`} options={options()} />
}

/**
 * Show auth method selection dialog
 *
 * @param dialog - Dialog context
 * @param agentName - Name of the agent requiring authentication
 * @param authMethods - Available authentication methods
 * @returns Promise that resolves to selected AuthMethod, or null if cancelled
 */
DialogAuth.show = (dialog: DialogContext, agentName: string, authMethods: AuthMethod[]): Promise<AuthMethod | null> => {
  return new Promise<AuthMethod | null>((resolve) => {
    dialog.replace(
      () => <DialogAuth agentName={agentName} authMethods={authMethods} onSelect={(method) => resolve(method)} />,
      () => resolve(null), // User cancelled with ESC
    )
  })
}
