import { Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { reviewTooltipKeybind } from "@/components/command-tooltip-keybind"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useSessionLayout } from "@/pages/session/session-layout"

export function SessionChangesToggle() {
  const language = useLanguage()
  const command = useCommand()
  const settings = useSettings()
  const { params, view } = useSessionLayout()
  const opened = () => view().reviewPanel.opened()
  const keybind = reviewTooltipKeybind(command)

  return (
    <Show when={settings.general.newLayoutDesigns() && params.id}>
      <TooltipV2
        class="shrink-0"
        placement="bottom"
        value={
          <>
            {language.t("session.review.change.other")}
            <Show when={keybind.length > 0}>
              <KeybindV2 keys={keybind} variant="neutral" />
            </Show>
          </>
        }
      >
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="large"
          class="shrink-0"
          icon={<Icon name="review" />}
          state={opened() ? "pressed" : undefined}
          data-expanded={opened() || undefined}
          aria-pressed={opened()}
          aria-expanded={opened()}
          aria-controls="review-panel"
          aria-label={language.t("session.review.change.other")}
          onClick={() => view().reviewPanel.toggle()}
        />
      </TooltipV2>
    </Show>
  )
}
