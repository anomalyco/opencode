import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useTabs } from "../context/tabs"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { useRoute } from "../context/route"

export function DialogNewTab() {
  const dialog = useDialog()
  const tabs = useTabs()
  const sdk = useSDK()
  const toast = useToast()
  const route = useRoute()

  return (
    <DialogPrompt
      title="New worktree tab"
      placeholder="branch name (leave empty for auto)"
      onConfirm={async (value) => {
        const name = value.trim() || undefined
        dialog.clear()

        const result = await sdk.client.worktree
          .create({
            worktreeCreateInput: { name },
          })
          .catch(() => undefined)

        if (!result?.data) {
          toast.show({
            message: "Failed to create worktree. Is this a git repository?",
            variant: "error",
            duration: 5000,
          })
          tabs.add()
          return
        }

        const worktree = result.data

        const sessionResult = await sdk.client.session
          .create({
            gitBranch: worktree.branch,
            gitWorktree: worktree.directory,
            displayName: worktree.name,
          })
          .catch(() => undefined)

        if (!sessionResult?.data) {
          toast.show({
            message: "Worktree created but failed to create session",
            variant: "error",
            duration: 5000,
          })
          tabs.add({ directory: worktree.directory, label: worktree.name })
          return
        }

        const session = sessionResult.data
        tabs.add({
          sessionID: session.id,
          directory: worktree.directory,
          label: worktree.name,
        })
        sdk.setDirectory(worktree.directory)
        route.navigate({ type: "session", sessionID: session.id })
      }}
    />
  )
}
