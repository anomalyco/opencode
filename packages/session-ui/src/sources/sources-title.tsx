import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { Show } from "solid-js"

/** The Sources panel's title in its side-panel tab: "Sources · 87". */
export function SourcesTitle(props: { count: number }) {
  const i18n = useI18n()

  return (
    <div class="flex min-w-0 items-center gap-1.5">
      <Icon name="globe" class="shrink-0" />
      <span class="truncate">{i18n.t("ui.sources.title")}</span>
      <Show when={props.count > 0}>
        <span class="shrink-0 text-v2-text-text-faint" aria-hidden="true">
          ·
        </span>
        <span class="shrink-0 tabular-nums text-v2-text-text-faint">{props.count}</span>
      </Show>
    </div>
  )
}
