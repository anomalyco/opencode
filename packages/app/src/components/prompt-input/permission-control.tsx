import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import type { Component, JSX } from "solid-js"

type PromptPermissionControlProps = {
  accepting: boolean
  fadeIn: boolean
  style: JSX.CSSProperties | undefined
  keybind: string
  t: (key: string) => string
  onToggle: () => void
}

export const PromptPermissionControl: Component<PromptPermissionControlProps> = (props) => {
  const label = () =>
    props.t(props.accepting ? "command.permissions.autoaccept.disable" : "command.permissions.autoaccept.enable")

  return (
    <div
      data-component="prompt-permissions-control"
      classList={{ "animate-in fade-in duration-300": props.fadeIn }}
    >
      <TooltipKeybind placement="top" gutter={4} title={label()} keybind={props.keybind}>
        <IconButton
          data-action="prompt-permissions"
          type="button"
          icon="shield"
          variant="ghost"
          class="size-8"
          classList={{
            "text-icon-success-base hover:bg-surface-success-base": props.accepting,
          }}
          style={props.style}
          onClick={props.onToggle}
          aria-label={label()}
          aria-pressed={props.accepting}
        />
      </TooltipKeybind>
    </div>
  )
}
