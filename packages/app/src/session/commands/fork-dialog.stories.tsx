import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { ForkDialog } from "./fork-dialog"

function ForkDialogStory() {
  const dialog = useDialog()
  const [store, setStore] = createStore({ selected: "No message selected" })

  const messages = [
    "Investigate how the command palette handles keyboard navigation.",
    "Show me where session titles are stored.",
    "Find the component that renders recent projects.",
    "Add a shortcut for reopening the last session.",
    "Keep the search query when returning to the list.",
    "Make long project names readable on smaller screens.",
    "Explain how worktrees are selected for a new session.",
    "Add a filter for archived sessions.",
  ]
    .map((text, index) => ({
      id: `story-message-${index}`,
      text,
      time: new Date(Date.UTC(2026, 9, 28, 10, index * 5)).toLocaleTimeString(undefined, { timeStyle: "short" }),
    }))
    .reverse()

  const open = () =>
    dialog.show(() => (
      <ForkDialog
        messages={messages}
        onSelect={(messageID) => {
          setStore("selected", messageID)
          dialog.close()
        }}
      />
    ))

  onMount(open)

  return (
    <div class="flex flex-col items-start gap-3">
      <Button variant="neutral" onClick={open}>
        Open fork session dialog
      </Button>
      <p role="status">{store.selected}</p>
    </div>
  )
}

export default {
  title: "App/Dialogs/Fork Session",
  id: "app-dialog-fork-session",
}

export const Default = {
  render: () => <ForkDialogStory />,
}
