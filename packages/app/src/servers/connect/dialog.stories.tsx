import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { DialogStoryRuntime, STORY_LOCKED_SERVER, STORY_SERVER } from "@/components-lab/dialog-story-runtime"
import type { ServerConnection } from "@/runtime/server/registry"
import { DialogServer } from "./dialog"

const editableServer: ServerConnection.Http = {
  type: "http",
  displayName: "Build cluster",
  http: { url: STORY_SERVER.http.url },
}

function ServerDialogStory(props: { mode: "add" | "edit"; server?: ServerConnection.Http }) {
  const dialog = useDialog()

  const open = () => void dialog.show(() => <DialogServer mode={props.mode} server={props.server} />)

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      {props.mode === "add" ? "Open add server dialog" : "Open edit server dialog"}
    </Button>
  )
}

export default {
  title: "App/Dialogs/Add Server",
  id: "app-dialog-add-server",
}

export const PairingLink = {
  render: () => (
    <DialogStoryRuntime>
      <ServerDialogStory mode="add" />
    </DialogStoryRuntime>
  ),
}

export const Password = {
  render: () => (
    <DialogStoryRuntime servers={[editableServer]}>
      <ServerDialogStory mode="edit" server={editableServer} />
    </DialogStoryRuntime>
  ),
}

export const SignedOut = {
  render: () => (
    <DialogStoryRuntime servers={[STORY_SERVER, STORY_LOCKED_SERVER]}>
      <ServerDialogStory mode="edit" server={STORY_LOCKED_SERVER} />
    </DialogStoryRuntime>
  ),
}
