import { createMemo } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useSessionLayout } from "@/session/session-layout"
import { reviewTooltipKeybind } from "@/shell/commands/tooltip-keybind"
import { SessionHeaderActions, type SessionHeaderActionsState } from "./session-header-actions"

export function SessionHeader() {
  const command = useCommand()
  const language = useLanguage()
  const { view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")

  const actions = createMemo<SessionHeaderActionsState>(() => ({
    reviewLabel: language.t("command.review.toggle"),
    reviewKeybind: reviewTooltipKeybind(command),
    reviewVisible: isDesktop(),
    reviewOpened: view().reviewPanel.opened(),
    onReviewToggle: () => view().reviewPanel.toggle(),
  }))

  return <SessionHeaderActions state={actions()} />
}
