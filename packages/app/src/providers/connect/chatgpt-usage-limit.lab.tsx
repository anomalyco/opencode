import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { DialogChatGPTUsageLimit } from "./chatgpt-usage-limit"

function UsageLimitLab(props: { workspace?: boolean }) {
  const dialog = useDialog()
  const open = () => dialog.show(() => <DialogChatGPTUsageLimit workspace={props.workspace} />)
  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open ChatGPT usage limit
    </Button>
  )
}

export default {
  title: "App/Dialogs/ChatGPT usage limit",
  id: "app-dialog-chatgpt-usage-limit",
}

export const ChatGPTUsageLimit = { render: () => <UsageLimitLab /> }

export const ChatGPTWorkspaceUsageLimit = { render: () => <UsageLimitLab workspace /> }
