import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { ExecutionMode, getModeController, getModeDisplay } from "@shell-mode"

const modes = [ExecutionMode.Auto, ExecutionMode.Shell, ExecutionMode.Agent]

const descriptions: Record<ExecutionMode, string> = {
  [ExecutionMode.Auto]: "Automatically route to shell or agent",
  [ExecutionMode.Shell]: "Execute commands in shell",
  [ExecutionMode.Agent]: "Send messages to AI agent",
}

export function DialogExecutionMode(props: { setMode: (mode: ExecutionMode) => void }) {
  const dialog = useDialog()
  const current = getModeController().getMode()

  const options = modes.map((mode) => {
    const display = getModeDisplay(mode)
    return {
      title: `${display.icon} ${display.name.trim()}`,
      value: mode,
      description: descriptions[mode],
      onSelect: () => {
        props.setMode(mode)
        dialog.clear()
      },
    }
  })

  return <DialogSelect title="Execution mode" options={options} current={current} />
}
