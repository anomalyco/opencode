import { Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Keybind } from "@opencode-ai/ui/keybind"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useCommand } from "@/shell/commands/command"
import { reviewTooltipKeybind } from "@/shell/commands/tooltip-keybind"
import { useLanguage } from "@/runtime/i18n/language"
import { useSessionLayout } from "@/session/session-layout"

export function SessionReviewToggle() {
  const command = useCommand()
  const language = useLanguage()
  const { view } = useSessionLayout()

  return (
    <SessionHeaderActions
      state={{
        reviewLabel: language.t("command.review.toggle"),
        reviewKeybind: reviewTooltipKeybind(command),
        reviewVisible: true,
        reviewOpened: view().reviewPanel.opened(),
        onReviewToggle: () => view().reviewPanel.toggle(),
      }}
    />
  )
}

export type SessionHeaderActionsState = {
  reviewLabel: string
  reviewKeybind: string[]
  reviewVisible: boolean
  reviewOpened: boolean
  onReviewToggle: () => void
  browser?: { label: string; opened: boolean; onToggle: () => void }
}

export function SessionHeaderActions(props: { state: SessionHeaderActionsState }) {
  return (
    <div class="flex items-center gap-2">
      <Show when={props.state.reviewVisible}>
        <Tooltip
          class="shrink-0"
          placement="bottom"
          value={
            <>
              {props.state.reviewLabel}
              <Show when={props.state.reviewKeybind.length > 0}>
                <Keybind keys={props.state.reviewKeybind} variant="neutral" />
              </Show>
            </>
          }
        >
          <IconButton
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            state={props.state.reviewOpened ? "pressed" : undefined}
            onClick={props.state.onReviewToggle}
            aria-label={props.state.reviewLabel}
            aria-expanded={props.state.reviewOpened}
            aria-controls="review-panel"
            icon={<Icon name="sidebar-right" />}
          />
        </Tooltip>
      </Show>
      <Show when={props.state.browser}>
        {(browser) => (
          <Tooltip class="shrink-0" placement="bottom" value={browser().label}>
            <IconButton
              type="button"
              variant="ghost-muted"
              size="large"
              class="!w-9 shrink-0"
              state={browser().opened ? "pressed" : undefined}
              onClick={browser().onToggle}
              aria-label={browser().label}
              aria-expanded={browser().opened}
              aria-controls="browser-panel"
              icon={<Icon name="window-cursor" size="small" />}
            />
          </Tooltip>
        )}
      </Show>
    </div>
  )
}
