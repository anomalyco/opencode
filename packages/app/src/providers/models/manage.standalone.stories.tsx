import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { DialogStoryRuntime } from "@/components-lab/dialog-story-runtime"
import { DialogManageModels } from "./manage"

function ManageModelsStory() {
  const dialog = useDialog()

  const open = () => void dialog.show(() => <DialogManageModels />)

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open manage models dialog
    </Button>
  )
}

export default {
  title: "App/Dialogs/Manage Models",
  id: "app-dialog-manage-models",
}

export const Default = {
  render: () => (
    <DialogStoryRuntime>
      <ManageModelsStory />
    </DialogStoryRuntime>
  ),
}
