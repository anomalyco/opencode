import { Show, type JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useTerminal, type LocalPTY } from "@/context/terminal"

export function SortableTerminalTab(props: {
  terminal: LocalPTY
  closing?: boolean
  onClose?: (id: string) => void
  onMinimize?: () => void
}): JSX.Element {
  const terminal = useTerminal()
  const sortable = createSortable(props.terminal.id)
  const label = () => (props.terminal.status === "error" ? `${props.terminal.title} (retry)` : props.terminal.title)
  const isActive = () => terminal.active() === props.terminal.id
  const handleClose = () => {
    if (props.closing) return
    if (props.onClose) {
      props.onClose(props.terminal.id)
      return
    }
    terminal.close(props.terminal.id)
  }
  const handleMinimize = () => {
    if (props.closing) return
    props.onMinimize?.()
  }
  return (
    // @ts-ignore
    <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative h-full">
        <Tabs.Trigger
          value={props.terminal.id}
          closeButton={
            <div class="flex items-center gap-1 ml-3">
              <Show when={isActive() && props.onMinimize}>
                <IconButton icon="dash" variant="ghost" onClick={handleMinimize} disabled={props.closing} />
              </Show>
              <IconButton icon="close" variant="ghost" onClick={handleClose} disabled={props.closing} />
            </div>
          }
        >
          {label()}
        </Tabs.Trigger>
      </div>
    </div>
  )
}
