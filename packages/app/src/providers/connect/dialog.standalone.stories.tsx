import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { DialogStoryRuntime, STORY_DIRECTORY } from "@/components-lab/dialog-story-runtime"
import { DialogConnectProvider, useProviderConnectController } from "./dialog"

function ConnectProviderDialogStory() {
  const dialog = useDialog()

  const open = () => void dialog.show(() => <DialogConnectProvider directory={STORY_DIRECTORY} />)

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open connect integration dialog
    </Button>
  )
}

function ProviderConnectionDialogStory(props: { provider: string }) {
  const dialog = useDialog()

  const controller = useProviderConnectController()

  const open = () => {
    controller.select(props.provider)
    void dialog.show(() => <DialogConnectProvider directory={STORY_DIRECTORY} controller={controller} />)
  }

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open {props.provider} connection dialog
    </Button>
  )
}

function renderConnection(provider: string) {
  return () => (
    <DialogStoryRuntime>
      <ProviderConnectionDialogStory provider={provider} />
    </DialogStoryRuntime>
  )
}

export default {
  title: "App/Dialogs/Connect Provider",
  id: "app-dialog-connect-provider",
}

export const Picker = {
  render: () => (
    <DialogStoryRuntime>
      <ConnectProviderDialogStory />
    </DialogStoryRuntime>
  ),
}

export const ChooseMethod = {
  render: renderConnection("opencode"),
}

export const ApiKey = {
  render: renderConnection("openrouter"),
}

export const LoginMethods = {
  render: renderConnection("openai"),
}
