import { createMemo, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useSessionLayout } from "@/pages/session/session-layout"
import { StatusPopoverV2 } from "../status-popover"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Keybind } from "@opencode-ai/ui/keybind"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { reviewTooltipKeybind } from "../command-tooltip-keybind"
import { useTitlebarRightMount } from "../titlebar"

export function SessionHeader() {
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const { view } = useSessionLayout()

  const status = settings.visibility.status
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const v2ActionsState = createMemo<SessionHeaderV2ActionsState>(() => ({
    statusVisible: status(),
    statusLabel: language.t("status.popover.trigger"),
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
          <SessionHeaderV2Actions state={v2ActionsState()} />
        </Portal>
      )}
    </Show>
  )
}

type SessionHeaderV2ActionsState = {
  statusVisible: boolean
  statusLabel: string
  reviewLabel: string
  reviewKeybind: string[]
  reviewVisible: boolean
  reviewOpened: boolean
  onReviewToggle: () => void
}

function SessionHeaderV2Actions(props: { state: SessionHeaderV2ActionsState }) {
  return (
    <div class="flex items-center gap-2">
      <Show when={props.state.statusVisible}>
        <Tooltip appearance="standard" placement="bottom" value={props.state.statusLabel}>
          <StatusPopoverV2 />
        </Tooltip>
      </Show>
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
            class="!w-9 shrink-0"
            state={props.state.reviewOpened ? "pressed" : undefined}
            onClick={props.state.onReviewToggle}
            aria-label={props.state.reviewLabel}
            aria-expanded={props.state.reviewOpened}
            aria-controls="review-panel"
            icon={<Icon name="sidebar-right" />}
          />
        </Tooltip>
      </Show>
    </div>
  )
}
