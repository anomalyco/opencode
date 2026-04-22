import { Show, createMemo } from "solid-js"
import { useI18n } from "../../../ui/src/context/i18n"
import { Icon } from "../../../ui/src/components/icon"
import { Spinner } from "../../../ui/src/components/spinner"

export type TranslationStateData = {
  is_translate?: boolean
  translate_status?: "idle" | "waiting" | "started" | "finished"
  translate_done?: number
  translate_total?: number
}

function label(i18n: ReturnType<typeof useI18n>, status: "waiting" | "started" | "finished") {
  if (status === "waiting") return i18n.t("ui.translation.waiting")
  if (status === "started") return i18n.t("ui.translation.started")
  return i18n.t("ui.translation.completed")
}

function percent(input?: TranslationStateData) {
  const total = input?.translate_total
  const done = input?.translate_done
  if (!total || total <= 0 || done === undefined) return
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

export function TranslationBanner(props: {
  translating: boolean
  items: TranslationStateData[]
  label: string
  class?: string
}) {
  const stats = createMemo(() => {
    if (!props.translating) return null
    const items = props.items ?? []
    const total = items.length
    if (total === 0) return null
    const done = items.filter((item) => item.translate_status === "finished" || item.is_translate).length
    return { total, done }
  })

  return (
    <Show when={stats()} keyed>
      {(s) => (
        <div
          class={`flex items-center gap-2 rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-1.5 ${props.class ?? ""}`.trim()}
          data-component="translation-banner"
          role="status"
          aria-live="polite"
        >
          <Spinner class="size-3 shrink-0" />
          <span class="text-12-medium text-text-secondary">
            {props.label} {s.done}/{s.total}
          </span>
        </div>
      )}
    </Show>
  )
}

export function TranslationState(props: { state?: TranslationStateData; class?: string }) {
  const i18n = useI18n()
  const status = () => {
    const value = props.state?.translate_status
    if (value && value !== "idle") return value
    if (props.state?.is_translate) return "finished" as const
  }

  return (
    <Show when={status()} keyed>
      {(value) => (
        <span
          class={`inline-flex items-center gap-1.5 rounded-full border border-border-weak-base bg-surface-raised-base px-2 py-0.5 text-11-medium text-text-secondary ${props.class ?? ""}`.trim()}
          data-component="translation-state"
          data-status={value}
        >
          <Show when={value === "finished"} fallback={<Spinner class="size-3" />}>
            <Icon name="check-small" size="small" />
          </Show>
          <span>{label(i18n, value)}</span>
          <Show when={percent(props.state) !== undefined}>
            <span class="text-text-tertiary">{percent(props.state)}%</span>
          </Show>
        </span>
      )}
    </Show>
  )
}
