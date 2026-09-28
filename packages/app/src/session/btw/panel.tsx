import { createEffect, createSignal, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { Markdown } from "@opencode/session-ui/markdown"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import type { SessionBtwModel } from "./model"

export function SessionBtwPanel(props: { btw: SessionBtwModel }) {
  const language = useLanguage()
  const platform = usePlatform()
  const [copied, setCopied] = createSignal(false)

  createEffect(() => {
    props.btw.answer()
    setCopied(false)
  })

  const copy = () => {
    const answer = props.btw.answer()
    if (!answer) return
    void (platform.writeClipboardText?.(answer) ?? navigator.clipboard.writeText(answer)).then(
      () => setCopied(true),
      () => showToast({ title: language.t("common.requestFailed") }),
    )
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-btw-panel">
      <div class="flex shrink-0 items-start justify-between gap-3 border-b border-v2-border-border-base px-5 py-4">
        <div class="min-w-0 text-13-regular text-text-weak">{props.btw.question()}</div>
        <Show when={props.btw.answer()}>
          <Tooltip value={copied() ? language.t("common.copied") : language.t("session.btw.copy")}>
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name={copied() ? "check" : "outline-copy"} />}
              aria-label={copied() ? language.t("common.copied") : language.t("session.btw.copy")}
              onClick={copy}
            />
          </Tooltip>
        </Show>
      </div>

      <div class="relative min-h-0 flex-1">
        <Switch>
          <Match when={props.btw.pending()}>
            <div
              data-component="session-working"
              role="status"
              class="flex h-9 items-center px-5 pt-3 text-[13px] font-[530] leading-text-compact"
            >
              <TextShimmer text={language.t("session.timeline.working")} active />
            </div>
          </Match>
          <Match when={props.btw.error()}>
            <div class="flex h-full flex-col items-center justify-center gap-3 px-8 pb-24 text-center">
              <div class="text-13-regular text-text-weak">{language.t("session.btw.error")}</div>
              <Button size="small" variant="outline" onClick={props.btw.retry}>
                {language.t("session.btw.retry")}
              </Button>
            </div>
          </Match>
          <Match when={props.btw.answer()}>
            <ScrollView class="absolute inset-0">
              <div class="px-5 py-4 pb-8">
                <Markdown text={props.btw.answer()} class="text-14-regular" />
              </div>
            </ScrollView>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
