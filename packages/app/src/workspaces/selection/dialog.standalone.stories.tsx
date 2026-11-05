import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { DialogStoryRuntime, STORY_DIRECTORY, STORY_SERVER } from "@/components-lab/dialog-story-runtime"
import { DirectoryPickerDialog } from "./dialog"

function DirectoryPickerStory(props: { mode?: "directory" | "file" }) {
  const dialog = useDialog()

  const [store, setStore] = createStore({ selected: "No path selected" })

  const open = () =>
    void dialog.show(() => (
      <DirectoryPickerDialog
        server={STORY_SERVER}
        location={{ directory: STORY_DIRECTORY }}
        start={STORY_DIRECTORY}
        mode={props.mode}
        onSelect={(result) => {
          const text = Array.isArray(result) ? result.join(", ") : (result ?? "Cancelled")
          setStore("selected", text)
        }}
      />
    ))

  onMount(open)

  return (
    <div class="flex flex-col items-start gap-3">
      <Button variant="neutral" onClick={open}>
        Open directory picker
      </Button>
      <p role="status">{store.selected}</p>
    </div>
  )
}

export default {
  title: "App/Dialogs/Directory Picker",
  id: "app-dialog-directory-picker",
}

export const OpenProject = {
  render: () => (
    <DialogStoryRuntime>
      <DirectoryPickerStory />
    </DialogStoryRuntime>
  ),
}

export const SelectFile = {
  render: () => (
    <DialogStoryRuntime>
      <DirectoryPickerStory mode="file" />
    </DialogStoryRuntime>
  ),
}
