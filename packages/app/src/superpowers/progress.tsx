import { Show, createSignal } from "solid-js"
import type { ProgressSummary, RunStatus } from "@bearmanser/opencode-superpowers-execution/contract"
import { useLanguage } from "@/runtime/i18n/language"

export function ExecutionProgress(props: {
  summary: ProgressSummary | undefined
  runStatus: RunStatus | undefined
  stale: boolean
}) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)

  return (
    <div class="execution-progress" data-testid="execution-progress" data-stale={String(props.stale)}>
      <div class="execution-progress__row">
        <Show when={props.runStatus}>
          {(status) => (
            <span
              class="execution-progress__state"
              data-testid="execution-run-state"
              data-status={status()}
              data-cancelled={status() === "cancelled" ? "true" : undefined}
            >
              {language.t(runStateKey(status()))}
            </span>
          )}
        </Show>
        <Show when={props.summary}>
          {(summary) => (
            <span class="execution-progress__count" data-testid="execution-progress-count">
              {language.t("execution.progress.count", { verified: summary().verified, total: summary().total })}
            </span>
          )}
        </Show>
        <Show when={props.summary && props.summary.percent !== null}>
          <span class="execution-progress__percent" data-testid="execution-progress-percent">
            {language.t("execution.progress.percent", { percent: props.summary?.percent ?? 0 })}
          </span>
        </Show>
        <Show when={props.stale}>
          <span class="execution-progress__stale" data-testid="execution-progress-stale">
            {language.t("execution.progress.stale")}
          </span>
        </Show>
        <button
          type="button"
          class="execution-progress__info"
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          {language.t("execution.progress.info")}
        </button>
      </div>
      <Show when={props.summary} fallback={
        <p class="execution-progress__none" data-testid="execution-progress-none" role="status">
          {language.t("execution.progress.none")}
        </p>
      }>
        {(summary) => (
          <div class="execution-progress__counts" data-testid="execution-progress-counts">
            <span data-testid="execution-progress-skipped">
              {language.plural("execution.progress.skipped", summary().skipped)}
            </span>
            <span>{language.plural("execution.progress.failed", summary().failed)}</span>
            <span>{language.plural("execution.progress.blocked", summary().blocked)}</span>
            <span>{language.plural("execution.progress.review", summary().awaitingReview)}</span>
            <span class="execution-progress__source" data-testid="execution-progress-source">
              {language.t("execution.progress.source")}
            </span>
          </div>
        )}
      </Show>
      <Show when={open()}>
        <div class="execution-progress__explanation" data-testid="execution-progress-explanation">
          <p>{language.t("execution.progress.provenance")}</p>
          <p>{language.t("execution.progress.provenanceDetail")}</p>
          <p>{language.t("execution.progress.fractionNote")}</p>
        </div>
      </Show>
    </div>
  )
}

function runStateKey(status: RunStatus) {
  if (status === "completed") return "execution.runState.completed" as const
  if (status === "cancelled") return "execution.runState.cancelled" as const
  return "execution.runState.active" as const
}
