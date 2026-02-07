import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useExecutionMode } from "@tui-integration"
import { ExecutionMode, getModeDisplay } from "@shell-mode"

const modes = [ExecutionMode.Auto, ExecutionMode.Shell, ExecutionMode.Agent]

const descriptions: Record<ExecutionMode, string> = {
  [ExecutionMode.Auto]: "Automatically route to shell or agent",
  [ExecutionMode.Shell]: "Execute commands in shell",
  [ExecutionMode.Agent]: "Send messages to AI agent",
}

export function DialogExecutionMode() {
  const executionMode = useExecutionMode()
  const dialog = useDialog()

  const options = modes.map((mode) => {
    const display = getModeDisplay(mode)
    return {
      title: `${display.icon} ${display.name.trim()}`,
      value: mode,
      description: descriptions[mode],
      onSelect: () => {
        executionMode.setMode(mode)
        dialog.clear()
      },
    }
  })

  return <DialogSelect title="Execution mode" options={options} current={executionMode.mode()} />
}
