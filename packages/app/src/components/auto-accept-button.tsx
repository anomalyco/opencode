import { Component, createMemo } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useCommand } from "@/context/command"

interface AutoAcceptButtonProps {
  style: () => Record<string, unknown>
}

export const AutoAcceptButton: Component<AutoAcceptButtonProps> = (props) => {
  const language = useLanguage()
  const permission = usePermission()
  const sdk = useSDK()
  const command = useCommand()
  const params = useParams()

  const accepting = createMemo(() => {
    const id = params.id
    if (!id) return permission.isAutoAcceptingDirectory(sdk.directory)
    return permission.isAutoAccepting(id, sdk.directory)
  })

  const acceptLabel = createMemo(() =>
    language.t(accepting() ? "command.permissions.autoaccept.disable" : "command.permissions.autoaccept.enable"),
  )

  const toggleAccept = () => {
    if (!params.id) {
      permission.toggleAutoAcceptDirectory(sdk.directory)
      return
    }

    permission.toggleAutoAccept(params.id, sdk.directory)
  }

  return (
    <TooltipKeybind
      placement="top"
      gutter={8}
      title={acceptLabel()}
      keybind={command.keybind("permissions.autoaccept")}
    >
      <Button
        data-action="prompt-permissions"
        variant="ghost"
        onClick={toggleAccept}
        classList={{
          "h-7 w-7 p-0 shrink-0 flex items-center justify-center": true,
          "text-text-base": !accepting(),
          "hover:bg-surface-success-base": accepting(),
        }}
        style={props.style()}
        aria-label={acceptLabel()}
        aria-pressed={accepting()}
      >
        <Icon name="shield" size="small" classList={{ "text-icon-success-base": accepting() }} />
      </Button>
    </TooltipKeybind>
  )
}
