import { createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { useTerminal } from "@/context/terminal"
import { decode64 } from "@/utils/base64"
import { SettingsPopup } from "./settings-popup"
import { CreateDialog } from "./create-dialog"

function RunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="size-4 text-icon-base">
      <path d="M6 4L16 10L6 16V4Z" fill="currentColor" />
    </svg>
  )
}

export function SessionHeaderActions() {
  const params = useParams()
  const dialog = useDialog()
  const layout = useLayout()
  const terminal = useTerminal()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey))

  const runCommand = (input: { command: string; args?: string[]; label: string; env?: Record<string, string> }) => {
    if (!params.dir) {
      showToast({
        variant: "error",
        title: `${input.label} failed`,
        description: "Open a project before running commands.",
      })
      return
    }

    const cwd = decode64(params.dir) ?? params.dir
    view().terminal.open()
    terminal.run({ command: input.command, args: input.args, title: input.label, cwd, env: input.env })
  }

  const run = () => {
    runCommand({ command: "latervibe", args: ["start", "--wait"], label: "Run" })
  }

  const publish = async () => {
    try {
      const res = await fetch("/api/auth/deploy-token", { credentials: "include" })
      if (!res.ok) {
        showToast({ variant: "error", title: "Publish failed", description: "Could not get deploy token. Please log in again." })
        return
      }
      const { token } = await res.json()
      runCommand({ command: "latervibe", args: ["publish", "--wait"], label: "Publish", env: { LATERVIBE_DEPLOY_TOKEN: token } })
    } catch {
      showToast({ variant: "error", title: "Publish failed", description: "Could not get deploy token." })
    }
  }

  return (
    <div class="flex items-center gap-2">
      <Button variant="secondary" class="rounded-sm h-[24px] w-[24px] p-0" onClick={run} aria-label="Run">
        <RunIcon />
      </Button>
      <Button variant="secondary" class="rounded-sm h-[24px] w-[24px] p-0" onClick={publish} aria-label="Publish">
        <Icon name="cloud-upload" size="small" class="text-icon-base" />
      </Button>
      <SettingsPopup />
      <Button
        variant="secondary"
        class="rounded-sm h-[24px] w-[24px] p-0"
        onClick={() => dialog.show(() => <CreateDialog />)}
        aria-label="Create"
      >
        <Icon name="plus-small" size="small" class="text-icon-base" />
      </Button>
    </div>
  )
}
