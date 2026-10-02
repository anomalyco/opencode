import { createEffect, createSignal, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { showToast } from "@opencode/ui/toast"
import { Markdown } from "@opencode/session-ui/markdown"
import { System, useExtension, type SessionView } from "../sdk"
import type { BtwModel } from "./model"

export default function SessionBtwPanel(props: { btw: BtwModel; session: SessionView }) {
  const ctx = useExtension()
  const system = ctx.use(System)
  const [copied, setCopied] = createSignal(false)
  const answer = () => props.btw.answer(props.session)

  createEffect(() => {
    answer()
    setCopied(false)
  })

  const copy = () => {
    const value = answer()
    if (!value) return
    void system.copy(value).then(
      () => setCopied(true),
      () => showToast({ title: ctx.t("common.requestFailed") }),
    )
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-btw-panel">
      <div class="flex shrink-0 items-start justify-between gap-3 border-b border-v2-border-border-base px-5 py-4">
        <div class="min-w-0 text-13-regular text-text-weak">{props.btw.question(props.session)}</div>
        <Show when={answer()}>
          <Tooltip value={copied() ? ctx.t("common.copied") : ctx.t("copy")}>
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name={copied() ? "check" : "outline-copy"} />}
              aria-label={copied() ? ctx.t("common.copied") : ctx.t("copy")}
              onClick={copy}
            />
          </Tooltip>
        </Show>
      </div>

      <div class="relative min-h-0 flex-1">
        <Switch>
          <Match when={props.btw.pending(props.session)}>
            <div
              data-component="session-working"
              role="status"
              class="flex h-9 items-center px-5 pt-3 text-[13px] font-[530] leading-text-compact"
            >
              <TextShimmer text={ctx.t("session.timeline.working")} active />
            </div>
          </Match>
          <Match when={props.btw.error(props.session)}>
            <div class="flex h-full flex-col items-center justify-center gap-3 px-8 pb-24 text-center">
              <div class="text-13-regular text-text-weak">{ctx.t("error")}</div>
              <Button size="small" variant="outline" onClick={() => props.btw.retry(props.session)}>
                {ctx.t("retry")}
              </Button>
            </div>
          </Match>
          <Match when={answer()}>
            <ScrollView class="absolute inset-0">
              <div class="px-5 py-4 pb-8">
                <Markdown text={answer()} class="text-14-regular" />
              </div>
            </ScrollView>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
