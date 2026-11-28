import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { usePlugin } from "@opencode/plugin/gui"
import { PluginContext } from "@opencode/plugin/gui/host"
import { onMount } from "solid-js"
import { DialogReleaseNotes, type Highlight } from "./whats-new"

const highlights: Highlight[] = [
  { title: "Split panes", description: "Work on two sessions side by side." },
  { title: "Voice input", description: "Talk to the agent instead of typing." },
  { title: "Session tabs", description: "Keep the sessions you use most open." },
]

function Open(props: { highlights: Highlight[] }) {
  const dialog = useDialog()

  // "Don't show these in the future" writes the app's real setting, so the story keeps it to itself.
  const context = Object.create(usePlugin(), {
    stores: { value: { releaseNotes: { update: () => {} } } },
  })

  const open = () =>
    dialog.show(() => (
      <PluginContext.Provider value={context}>
        <DialogReleaseNotes highlights={props.highlights} dialog={{ close: () => dialog.close() }} />
      </PluginContext.Provider>
    ))

  onMount(open)

  return <Button onClick={open}>Open What's New</Button>
}

export default { title: "App/Dialogs/What's New", id: "app-dialog-whats-new" }

export const Paged = { render: () => <Open highlights={highlights} /> }

export const Single = { render: () => <Open highlights={highlights.slice(0, 1)} /> }
