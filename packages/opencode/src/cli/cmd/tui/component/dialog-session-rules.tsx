import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"

// TODO: Regenerate SDK types to include 'rules' field, then remove these type casts
type SessionWithRules = { rules?: string }
type UpdateWithRules = { sessionID: string; rules?: string }

export function DialogSessionRules(props: { session: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const session = createMemo(() => sync.session.get(props.session) as (SessionWithRules | undefined))

  return (
    <DialogPrompt
      title="Session Rules"
      value={session()?.rules ?? ""}
      onConfirm={(value) => {
        const update = sdk.client.session.update as (args: UpdateWithRules) => Promise<unknown>
        update({ sessionID: props.session, rules: value || undefined })
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
