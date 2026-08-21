import { createMemo, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Portal } from "solid-js/web"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useSessionLayout } from "@/session/session-layout"
import { reviewTooltipKeybind } from "@/shell/commands/tooltip-keybind"
import { StatusPopover } from "@/shell/status/status-popover"
import { useTitlebarRightMount } from "@/shell/titlebar/titlebar"
import { SessionHeaderActions, type SessionHeaderActionsState } from "./session-header-actions"

export function SessionHeader() {
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const { view } = useSessionLayout()

  const status = settings.visibility.status
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const actions = createMemo<SessionHeaderActionsState>(() => ({
    status: status() ? { label: language.t("status.popover.trigger"), content: () => <StatusPopover /> } : undefined,
    reviewLabel: language.t("command.review.toggle"),
    reviewKeybind: reviewTooltipKeybind(command),
    reviewVisible: isDesktop(),
    reviewOpened: view().reviewPanel.opened(),
    onReviewToggle: () => view().reviewPanel.toggle(),
  }))

  const rightMount = useTitlebarRightMount()

  return (
    <Show when={rightMount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <SessionHeaderActions state={actions()} />
        </Portal>
      )}
    </Show>
  )
}
