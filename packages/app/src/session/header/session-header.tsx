import { createMemo, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useSessionLayout } from "@/session/session-layout"
import { reviewTooltipKeybind } from "@/shell/commands/tooltip-keybind"
import { StatusPopover } from "@/shell/status/status-popover"
import { TitlebarRight } from "@/shell/titlebar/right-slot"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { SessionHeaderActions, type SessionHeaderActionsState } from "./session-header-actions"

export function SessionHeader() {
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const { view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")

  const actions = createMemo<SessionHeaderActionsState>(() => ({
    reviewLabel: language.t("command.review.toggle"),
    reviewKeybind: reviewTooltipKeybind(command),
    reviewVisible: isDesktop(),
    reviewOpened: view().reviewPanel.opened(),
    onReviewToggle: () => view().reviewPanel.toggle(),
  }))

  return (
    <>
      <TitlebarRight>
        <Show when={isDesktop() && settings.visibility.status()}>
          <Tooltip appearance="standard" placement="bottom" value={language.t("status.popover.trigger")}>
            <StatusPopover />
          </Tooltip>
        </Show>
      </TitlebarRight>
      <SessionHeaderActions state={actions()} />
    </>
  )
}
