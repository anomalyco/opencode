import { Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { ExecutionModel } from "./model"

export function ExecutionPendingNotice(props: { model: ExecutionModel; onReturn: () => void }) {
  const language = useLanguage()
  const pending = () => props.model.attention().needsInput
  return (
    <Show when={pending() > 0}>
      <div
        data-slot="execution-pending-banner"
        data-testid="execution-pending-banner"
        class="execution-expanded__banner execution-panel__pending"
        role="status"
      >
        <span>{language.plural("execution.expanded.pending", pending())}</span>
        <button
          type="button"
          data-testid="execution-return-to-request"
          class="execution-expanded__action"
          onClick={() => props.onReturn()}
        >
          {language.t("execution.expanded.returnToRequest")}
        </button>
      </div>
    </Show>
  )
}
