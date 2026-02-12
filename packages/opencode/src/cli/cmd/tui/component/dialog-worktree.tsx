import path from "path"
import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

const MAIN = "main"
const CREATE = "create"

export function DialogWorktree(props: {
  current: string
  onSelect: (value: string) => void
}) {
  const sync = useSync()
  const dialog = useDialog()

  const branch = createMemo(() => sync.data.vcs?.branch)

  const options = createMemo(() => {
    const items = [
      {
        value: MAIN,
        title: "Main workspace",
        description: branch() ? `branch: ${branch()}` : undefined,
      },
    ]
    for (const sandbox of sync.data.sandboxes) {
      items.push({
        value: sandbox,
        title: path.basename(sandbox),
        description: sandbox,
      })
    }
    items.push({
      value: CREATE,
      title: "Create new workspace",
      description: "Create a new git worktree",
    })
    return items
  })

  return (
    <DialogSelect
      title="Select workspace"
      current={props.current}
      options={options()}
      onSelect={(option) => {
        props.onSelect(option.value)
        dialog.clear()
      }}
    />
  )
}
