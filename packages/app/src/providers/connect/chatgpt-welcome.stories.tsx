import { Button } from "@Mackery6969/ui/button"
import { useDialog } from "@Mackery6969/ui/context/dialog"
import { onMount } from "solid-js"
import { DialogChatGPTPlanWelcome } from "./chatgpt-welcome"

function WelcomeStory() {
  const dialog = useDialog()
  const open = () => dialog.show(() => <DialogChatGPTPlanWelcome />)
  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open ChatGPT plan welcome
    </Button>
  )
}

export default {
  title: "App/Dialogs/ChatGPT welcome",
  id: "app-dialog-chatgpt-welcome",
}

export const ChatGPTPlanWelcome = { render: () => <WelcomeStory /> }
