import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { DialogLabRuntime, LAB_DIRECTORY, LAB_SERVER } from "@/lab/dialog-runtime"
import { DirectoryPickerDialog } from "./dialog"

function DirectoryPickerLab(props: { mode?: "directory" | "file"; start?: string }) {
  const dialog = useDialog()

  const [store, setStore] = createStore({ selected: "No path selected" })

  const open = () =>
    void dialog.show(() => (
      <DirectoryPickerDialog
        server={LAB_SERVER}
        location={{ directory: LAB_DIRECTORY }}
        start={props.start ?? LAB_DIRECTORY}
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
    <DialogLabRuntime>
      <DirectoryPickerLab />
    </DialogLabRuntime>
  ),
}

export const SelectFile = {
  render: () => (
    <DialogLabRuntime>
      <DirectoryPickerLab mode="file" />
    </DialogLabRuntime>
  ),
}

export const MissingDirectory = {
  render: () => (
    <DialogLabRuntime>
      <DirectoryPickerLab start={`${LAB_DIRECTORY}/removed-folder`} />
    </DialogLabRuntime>
  ),
}
