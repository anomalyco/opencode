import { Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useCommand } from "@/shell/commands/command"
import { reviewTooltipKeybind, terminalTooltipKeybind } from "@/shell/commands/tooltip-keybind"
import { useLanguage } from "@/runtime/i18n/language"
import { useSessionLayout } from "@/session/session-layout"
import { useTerminal } from "@/session/terminal/context"

export function SessionHeaderToggles() {
  const command = useCommand()
  const language = useLanguage()
  const terminal = useTerminal()
  const { view } = useSessionLayout()

  return (
    <SessionHeaderActions
      state={{
        reviewLabel: language.t("command.review.toggle"),
        reviewKeybind: reviewTooltipKeybind(command),
        reviewVisible: true,
        reviewOpened: view().reviewPanel.opened(),
        onReviewToggle: () => view().reviewPanel.toggle(),
        terminalLabel: language.t("command.terminal.toggle"),
        terminalKeybind: terminalTooltipKeybind(command),
        terminalVisible: true,
        terminalOpened: view().terminal.opened(),
        onTerminalToggle: () => {
          if (view().terminal.opened()) {
            terminal.cancelFocus()
            view().terminal.close()
            return
          }
          view().terminal.open()
          terminal.requestFocus(terminal.active())
        },
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
  terminalLabel: string
  terminalKeybind: string[]
  terminalVisible: boolean
  terminalOpened: boolean
  onTerminalToggle: () => void
}

// This fixed control sits above moving panel contents.
const fixedControlStyle = {
  "--v2-overlay-simple-overlay-hover": "var(--v2-background-bg-layer-01)",
  "--v2-overlay-simple-overlay-pressed": "var(--v2-background-bg-layer-02)",
}

export function SessionHeaderActions(props: { state: SessionHeaderActionsState }) {
  return (
    <div class="flex items-center gap-2">
      <Show when={props.state.terminalVisible}>
        <Tooltip
          class="shrink-0"
          placement="bottom"
          value={
            <>
              {props.state.terminalLabel}
              <Show when={props.state.terminalKeybind.length > 0}>
                <Keybind keys={props.state.terminalKeybind} variant="neutral" />
              </Show>
            </>
          }
        >
          <IconButton
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            style={fixedControlStyle}
            state={props.state.terminalOpened ? "pressed" : undefined}
            onClick={props.state.onTerminalToggle}
            aria-label={props.state.terminalLabel}
            aria-expanded={props.state.terminalOpened}
            aria-controls="terminal-panel"
            icon={<Icon name="terminal" />}
          />
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
            class="shrink-0"
            style={fixedControlStyle}
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
