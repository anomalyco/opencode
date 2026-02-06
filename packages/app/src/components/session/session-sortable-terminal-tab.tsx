import type { LocalPTY } from "@/context/terminal"
import { SortableTerminalTab as ForkSortableTerminalTab } from "@opencode-ai/fork-terminal"
import { useTerminal } from "@/context/terminal"

export function SortableTerminalTab(props: {
  terminal: LocalPTY
  closing?: boolean
  onClose?: (id: string) => void
  onMinimize?: () => void
}) {
  const terminal = useTerminal()
  return (
    <ForkSortableTerminalTab
      terminal={props.terminal}
      closing={props.closing}
      onClose={props.onClose}
      onMinimize={props.onMinimize}
      terminalApi={{
        active: terminal.active,
        close: terminal.close,
      }}
    />
  )
}
