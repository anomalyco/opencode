import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog } from "@opencode/ui/dialog"
import { showToast } from "@/shell/notifications/toast"
import { onMount } from "solid-js"
import { ConnectedModelPicker } from "./connected-models"

type Groups = Parameters<typeof ConnectedModelPicker>[0]["groups"]

const models = (providerID: string, names: string[]) =>
  names.map((name) => ({ id: name.toLowerCase().replaceAll(" ", "-"), name, providerID }))

const google: Groups = [
  {
    provider: { id: "google", name: "Google" },
    models: models("google", [
      "Gemini 3 Pro Preview",
      "Gemini 3 Flash",
      "Gemini 2.5 Pro",
      "Gemini 2.5 Flash",
      "Gemini 2.5 Flash Lite",
    ]),
  },
]

const workspace: Groups = [
  {
    provider: { id: "opencode-go", name: "Acme / OpenCode Go" },
    models: models("opencode-go", ["GLM-5 Go", "Kimi K3", "DeepSeek V4 Pro", "Qwen 4 Coder"]),
  },
  {
    provider: { id: "opencode", name: "Acme / OpenCode Zen" },
    models: models("opencode", ["Claude Opus 5.5", "Claude Sonnet 5", "GPT-5.6", "Gemini 3 Pro", "Big Pickle"]),
  },
]

// The connect dialog's models step around the real picker. Picking only shows a toast here.
function PickerStory(props: { providerName: string; groups: Groups; workspace?: { prefix: string }; server?: string }) {
  const dialog = useDialog()

  const open = () =>
    dialog.show(() => (
      <Dialog size="large" fit class="command-palette model-dialog [font-family:var(--v2-font-family-sans)]">
        <ConnectedModelPicker
          providerName={props.providerName}
          groups={props.groups}
          workspace={props.workspace}
          server={props.server}
          onSelect={(model) => {
            dialog.close()
            showToast({ variant: "success", icon: "circle-check", title: `Picked ${model.name}` })
          }}
        />
      </Dialog>
    ))

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open connected model picker
    </Button>
  )
}

export default {
  title: "App/Dialogs/Connected model picker",
  id: "app-dialog-connected-model-picker",
}

/** One provider: no section headers. Type to filter, Enter or click picks. */
export const SingleProvider = { render: () => <PickerStory providerName="Google" groups={google} /> }

/** A Console workspace: one section per provider, named without the workspace prefix. */
export const ConsoleWorkspace = {
  render: () => <PickerStory providerName="OpenCode" groups={workspace} workspace={{ prefix: "Acme / " }} />,
}

/** A Console sign-in through a remote server names the server it is stored on. */
export const ConsoleRemote = {
  render: () => (
    <PickerStory providerName="OpenCode" groups={workspace} workspace={{ prefix: "Acme / " }} server="Dev box" />
  ),
}
