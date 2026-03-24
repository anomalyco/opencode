import { Show, type JSX } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useOthersConfig } from "../context/others-config"

interface OpenProjectButtonProps {
  placement?: "top" | "bottom" | "left" | "right"
  label: JSX.Element
  keybind?: string
  onClick: () => void
}

/**
 * 打开项目按钮
 * 可通过 others.json 配置隐藏
 */
export function OpenProjectButton(props: OpenProjectButtonProps) {
  const othersConfig = useOthersConfig()

  return (
    <Show when={othersConfig.shouldShowUIElement("openProjectButton")}>
      <Tooltip
        placement={props.placement || "right"}
        value={
          <div class="flex items-center gap-2">
            <span>{props.label}</span>
            <Show when={!!props.keybind}>
              <span class="text-icon-base text-12-medium">{props.keybind}</span>
            </Show>
          </div>
        }
      >
        <IconButton
          icon="plus"
          variant="ghost"
          size="large"
          onClick={props.onClick}
          aria-label={typeof props.label === "string" ? props.label : undefined}
        />
      </Tooltip>
    </Show>
  )
}
