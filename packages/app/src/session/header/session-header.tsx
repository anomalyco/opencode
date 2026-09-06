import { Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useSessionLayout } from "@/session/session-layout"
import { StatusPopover } from "@/shell/status/status-popover"
import { TitlebarRight } from "@/shell/titlebar/right-slot"
import { Tooltip } from "@opencode-ai/ui/tooltip"

export function SessionHeader() {
  const language = useLanguage()
  const settings = useSettings()
  const { view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")

  return (
    <>
      <TitlebarRight>
        <Show when={isDesktop() && settings.visibility.status()}>
          <Tooltip appearance="standard" placement="bottom" value={language.t("status.popover.trigger")}>
            <StatusPopover />
          </Tooltip>
        </Show>
      </TitlebarRight>
      <Show when={isDesktop() && !view().reviewPanel.opened()}>
        <div class="size-7 shrink-0" aria-hidden />
      </Show>
    </>
  )
}
