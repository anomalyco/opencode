import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Show, createSignal } from "solid-js"
import { useLayout } from "@/context/layout"

const GRID_MODES = [1, 2, 3, 4, 6, 8] as const

export function GridToggle(props: { dir: string }) {
  const layout = useLayout()
  const [open, setOpen] = createSignal(false)
  const currentMode = () => layout.grid.mode(props.dir)()

  return (
    <DropdownMenu gutter={4} placement="bottom-end" open={open()} onOpenChange={setOpen}>
      <Tooltip placement="bottom" value="Grid layout">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          class="titlebar-icon w-8 h-6 p-0 box-border"
          aria-label="Grid layout"
        />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel>Grid</DropdownMenu.GroupLabel>
            {GRID_MODES.map((mode) => (
              <DropdownMenu.Item
                onSelect={() => {
                  layout.grid.setMode(props.dir, mode)
                  setOpen(false)
                }}
              >
                <div class="flex size-5 shrink-0 items-center justify-center">
                  <Show when={currentMode() === mode}>
                    <Icon name="check-small" size="small" class="text-icon-weak" />
                  </Show>
                </div>
                <DropdownMenu.ItemLabel>{mode}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Group>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onSelect={() => {
              const active = layout.grid.active(props.dir)()
              const cells = layout.grid.cells(props.dir)()
              const isExtra = active && cells.some((c) => c.sessionID === active)
              if (isExtra) {
                layout.grid.removeCell(props.dir, active)
              } else {
                layout.grid.setMode(props.dir, 1)
              }
              setOpen(false)
            }}
          >
            <DropdownMenu.ItemLabel>Close session</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
