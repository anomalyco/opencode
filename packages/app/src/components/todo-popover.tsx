import { Popover } from "@opencode-ai/ui/popover"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import { createMemo, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { useSDK } from "@/context/sdk"
import { SidebarTodo } from "@/pages/layout/sidebar-todo"
import { SidebarLinear } from "@/pages/layout/sidebar-linear"
import { createMediaQuery } from "@solid-primitives/media"

/**
 * TodoPopover — popup-style Todo panel mirroring the MCP/LSP/Plugin popover
 * pattern (see StatusPopoverV2). The panel floats over the content area
 * instead of squeezing the main panel. Open state is local (not persisted)
 * to match the ephemeral nature of popovers.
 *
 * Two variants:
 *   - V2 (newLayoutDesigns): IconButtonV2 + TooltipV2 + KeybindV2
 *   - Legacy: Button + TooltipKeybind
 */
export function TodoPopover(props: { v2: boolean }): JSX.Element {
  const language = useLanguage()
  const command = useCommand()
  const sdk = useSDK()
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const directory = createMemo(() => sdk().directory ?? "")
  // Per AGENTS.md: prefer createStore over createSignal for UI state.
  // `shown` is the only local state; using a store keeps the pattern uniform
  // across the Todo Sidebar feature components.
  const [state, setState] = createStore({ shown: false })
  const label = createMemo(() => language.t("command.todo.toggle"))
  const keybind = createMemo(() => command.keybindParts("todo.toggle"))

  // Register the toggle command so the keybind still works. The command
  // flips the local store flag instead of the persisted layout state.
  command.register(() => [
    {
      id: "todo.toggle",
      title: label(),
      category: language.t("command.category.view"),
      keybind: "mod+shift+i",
      onSelect: () => {
        if (!directory()) return
        setState("shown", (prev) => !prev)
      },
    },
  ])

  const popoverClass =
    "[&_[data-slot=popover-body]]:p-0 w-[400px] max-w-[calc(100vw-40px)] max-h-[70vh] bg-v2-background-bg-base border border-v2-border-border-base shadow-[var(--v2-elevation-raised)] rounded-xl"

  const body = () => (
    <Show when={state.shown && directory()}>
      <div class="flex flex-col max-h-[70vh] overflow-hidden">
        <SidebarTodo directory={directory} />
        <SidebarLinear directory={directory} />
      </div>
    </Show>
  )

  if (props.v2) {
    return (
      <Show when={isDesktop() && directory()}>
        <TooltipV2
          class="shrink-0"
          placement="bottom"
          value={
            <>
              {label()}
              <Show when={keybind().length > 0}>
                <KeybindV2 keys={keybind()} variant="neutral" />
              </Show>
            </>
          }
        >
          <Popover
            open={state.shown}
            onOpenChange={(next: boolean) => setState("shown", next)}
            triggerAs={IconButtonV2}
            triggerProps={{
              variant: "ghost-muted",
              size: "large",
              class: "!w-9 shrink-0",
              state: state.shown ? "pressed" : undefined,
              "aria-label": label(),
              "aria-expanded": state.shown,
            }}
            trigger={<Icon name="task" />}
            class={popoverClass}
            gutter={4}
            placement="bottom-end"
          >
            {body()}
          </Popover>
        </TooltipV2>
      </Show>
    )
  }

  return (
    <Show when={isDesktop() && directory()}>
      <TooltipKeybind title={label()} keybind={command.keybind("todo.toggle")}>
        <Popover
          open={state.shown}
          onOpenChange={(next: boolean) => setState("shown", next)}
          triggerAs={Button}
          triggerProps={{
            variant: "ghost",
            class: "group/todo-toggle titlebar-icon w-8 h-6 p-0 box-border",
            "aria-label": label(),
            "aria-expanded": state.shown,
          }}
          trigger={
            <Icon
              size="small"
              name="task"
              classList={{
                "text-icon-strong": state.shown,
                "text-icon-weak": !state.shown,
              }}
            />
          }
          class={popoverClass}
          gutter={4}
          placement="bottom-end"
        >
          {body()}
        </Popover>
      </TooltipKeybind>
    </Show>
  )
}
