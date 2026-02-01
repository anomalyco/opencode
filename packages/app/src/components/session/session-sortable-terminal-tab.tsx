import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useTerminal, type LocalPTY } from "@/context/terminal"

export function SortableTerminalTab(props: { terminal: LocalPTY }): JSX.Element {
  const terminal = useTerminal()
  const sortable = createSortable(props.terminal.id)
  const label = () => (props.terminal.status === "error" ? `${props.terminal.title} (retry)` : props.terminal.title)
  return (
    // @ts-ignore
    <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative h-full">
        <Tabs.Trigger
          value={props.terminal.id}
          closeButton={
            terminal.all().length > 1 && (
              <IconButton icon="close" variant="ghost" onClick={() => terminal.close(props.terminal.id)} />
            )
          }
        >
          {label()}
        </Tabs.Trigger>
      </div>
    </div>
  )
}
