import { createMemo, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useSessionLayout } from "@/session/session-layout"
import { reviewTooltipKeybind } from "@/components/command-tooltip-keybind"
import { StatusPopoverV2 } from "@/components/status-popover"
import { useTitlebarRightMount } from "@/components/titlebar"
import { SessionHeaderActions, type SessionHeaderActionsState } from "./session-header-actions"

export function SessionHeader() {
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const { view } = useSessionLayout()

  const status = settings.visibility.status
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const actions = createMemo<SessionHeaderActionsState>(() => ({
    status: status() ? { label: language.t("status.popover.trigger"), content: () => <StatusPopoverV2 /> } : undefined,
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
