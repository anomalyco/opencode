import { createMemo, createSignal, onCleanup, type JSX, type ParentProps } from "solid-js"
import { Button } from "@opencode/ui/button"
import { isFreeModel } from "@/providers/models/models"
import type { ModelSelection } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { useUsageFormat } from "@/usage/format"
import { usageBlock, type UsageBlock, type UsageRefusal } from "@/usage/limits"
import { createUsageLimits } from "@/usage/model"

/**
 * Why the selected model can't run, from the session's last refusal (kept on its message, so it survives a reload) or
 * the usage limits. It clears when the model changes or the limit resets.
 */
export function useUsageBlock(input: { selection: () => ModelSelection; last: () => UsageRefusal | undefined }) {
  const limits = createUsageLimits({ model: () => input.selection().current() })
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => clearInterval(timer))

  return createMemo(() => {
    const model = input.selection().current()

    return usageBlock({ model, free: !!model && isFreeModel(model), info: limits(), last: input.last(), now: now() })
  })
}

// The card that stands in for the composer while the selected model can't run.
export function SessionLimitPanel(props: ParentProps<{ component: string; title: JSX.Element; body: JSX.Element }>) {
  return (
    <div
      data-component={props.component}
      role="status"
      class="flex flex-col gap-4 rounded-xl bg-v2-background-bg-base p-2 [[data-color-scheme=dark]_&]:bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-raised)] [font-family:var(--v2-font-family-sans)]"
    >
      <div class="flex flex-col gap-0.5 ps-1.5 pe-1 pt-1">
        <div class="text-[13px] font-[530] leading-[var(--line-height-base)] text-v2-text-text-base">{props.title}</div>
        <div class="text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-text-text-muted [font-variant-numeric:tabular-nums]">
          {props.body}
        </div>
      </div>
      <div class="flex items-center justify-end gap-1.5">{props.children}</div>
    </div>
  )
}

// A usage limit or the workspace's credits stop the selected model; another model keeps going.
export function SessionUsageBlockPanel(props: { block: UsageBlock; model: string; onChangeModel: () => void }) {
  const language = useLanguage()
  const format = useUsageFormat()

  // Today's reset reads as a time, a later one with its date.
  const time = (at: number) =>
    new Date(at).toDateString() === new Date().toDateString()
      ? new Intl.DateTimeFormat(language.intl(), { timeStyle: "short" }).format(at)
      : format.shortTime(at)

  const title = () => {
    const block = props.block

    if (block.kind === "go") return language.t("session.usageBlock.go.title")
    if (block.kind === "model") return language.t("session.usageBlock.model.title", { model: props.model })
    if (block.kind === "workspace") return language.t("session.usageBlock.workspace.title")
    return language.t("session.usageBlock.credits.title")
  }

  const body = () => {
    const block = props.block

    if (block.kind === "credits") return language.t("session.usageBlock.credits.body")
    const at = block.resetsAt

    if (block.kind === "go") {
      if (at === undefined) return language.t("session.usageBlock.go.noReset")
      if (block.window === "rolling") return language.t("session.usageBlock.go.rolling", { time: time(at) })
      if (block.window === "weekly") return language.t("session.usageBlock.go.weekly", { time: format.shortTime(at) })
      if (block.window === "monthly") return language.t("session.usageBlock.go.monthly", { time: format.shortTime(at) })
      return language.t("session.usageBlock.go.reset", { time: time(at) })
    }

    if (block.kind === "model")
      return at === undefined
        ? language.t("session.usageBlock.model.noReset")
        : language.t("session.usageBlock.model.reset", { time: format.shortTime(at) })

    return at === undefined
      ? language.t("session.usageBlock.workspace.noReset")
      : language.t("session.usageBlock.workspace.reset", { time: format.shortTime(at) })
  }

  return (
    <SessionLimitPanel component={`session-usage-block-${props.block.kind}`} title={title()} body={body()}>
      <Button
        data-action="session-usage-block-change-model"
        type="button"
        size="normal"
        variant="submit"
        class="![font-weight:530]"
        onClick={props.onChangeModel}
      >
        {language.t("session.usageBlock.change")}
      </Button>
    </SessionLimitPanel>
  )
}
