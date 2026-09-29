import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { DialogChatGPTUsageLimit } from "./chatgpt-usage-limit"

function UsageLimitStory() {
  const dialog = useDialog()
  const open = () => dialog.show(() => <DialogChatGPTUsageLimit onGo={() => {}} />)
  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open ChatGPT usage limit
    </Button>
  )
}

export default {
  title: "App/Dialogs/Connect Provider",
  id: "app-dialog-chatgpt-usage-limit",
}

export const ChatGPTUsageLimit = { render: () => <UsageLimitStory /> }
