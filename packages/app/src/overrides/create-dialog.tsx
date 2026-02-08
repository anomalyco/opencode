import { createMemo, createSignal } from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { useTerminal } from "@/context/terminal"
import { decode64 } from "@/utils/base64"
import { getDirectory } from "@opencode-ai/util/path"

export function CreateDialog() {
  const dialog = useDialog()
  const params = useParams()
  const layout = useLayout()
  const terminal = useTerminal()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey))
  const [name, setName] = createSignal("")

  const runCreate = () => {
    const value = name().trim()
    if (!value) {
      showToast({
        variant: "error",
        title: "Create failed",
        description: "Enter a project name first.",
      })
      return
    }

    if (!params.dir) {
      showToast({
        variant: "error",
        title: "Create failed",
        description: "Open a project before creating a new one.",
      })
      return
    }

    const cwd = decode64(params.dir) ?? params.dir
    const dir = getDirectory(cwd)
    view().terminal.open()
    terminal.run({ command: "latervibe", args: ["create", value], title: "New Project", cwd: dir })
    setName("")
    dialog.close()
  }

  return (
    <Dialog title="New Project" class="w-full max-w-[420px] mx-auto">
      <div class="flex flex-col gap-4 p-6 pt-0">
        <p class="text-12-regular text-text-weak">
          When your project has been created, go to the left sidebar press the plus icon, and find the project under
          "projects".
        </p>
        <TextField
          autofocus
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          placeholder="Project name"
        />
        <Button variant="primary" class="h-[32px]" onClick={runCreate}>
          Create
        </Button>
      </div>
    </Dialog>
  )
}
