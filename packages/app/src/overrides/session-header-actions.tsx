import { createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useLayout } from "@/context/layout"
import { useTerminal } from "@/context/terminal"
import { decode64 } from "@/utils/base64"
import { SettingsPopup } from "./settings-popup"

function RunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="size-4 text-icon-base">
      <path d="M6 4L16 10L6 16V4Z" fill="currentColor" />
    </svg>
  )
}

export function SessionHeaderActions() {
  const params = useParams()
  const layout = useLayout()
  const terminal = useTerminal()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey))

  const runCommand = (input: { command: string; args?: string[]; label: string }) => {
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
    terminal.run({ command: input.command, args: input.args, title: input.label, cwd })
  }

  const run = () => {
    runCommand({ command: "latervibe", args: ["start", "--wait"], label: "Run" })
  }

  const deploy = () => {
    runCommand({ command: "latervibe", args: ["deploy", "--wait"], label: "Deploy" })
  }

  return (
    <div class="flex items-center gap-2">
      <Button variant="secondary" class="rounded-sm h-[24px] w-[24px] p-0" onClick={run} aria-label="Run">
        <RunIcon />
      </Button>
      <Button variant="secondary" class="rounded-sm h-[24px] w-[24px] p-0" onClick={deploy} aria-label="Deploy">
        <Icon name="cloud-upload" size="small" class="text-icon-base" />
      </Button>
      <SettingsPopup
        onRun={() => runCommand({ command: "latervibe", args: ["settings", "--wait"], label: "Settings" })}
      />
    </div>
  )
}
