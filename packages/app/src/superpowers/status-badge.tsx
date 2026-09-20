import { Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import type { ExecutionModel } from "./model"

export type ExecutionAttentionState = "stale" | "needs_input" | "failed" | "blocked" | "normal"

export function attentionState(input: {
  stale: boolean
  needsInput: number
  failed: number
  blocked: number
}): ExecutionAttentionState {
  if (input.stale) return "stale"
  if (input.needsInput > 0) return "needs_input"
  if (input.failed > 0) return "failed"
  if (input.blocked > 0) return "blocked"
  return "normal"
}

const STATE_ICONS: Record<ExecutionAttentionState, string> = {
  stale: "outline-hexagonal-warning",
  needs_input: "help",
  failed: "circle-exclamation",
  blocked: "status",
  normal: "status-active",
}

export function ExecutionStatusBadge(props: { model: ExecutionModel; onOpen: () => void }) {
  const language = useLanguage()
  const state = () => attentionState(props.model.attention())
  const statusLabel = () => language.t(statusKey(state()))

  return (
    <div class="flex items-center gap-1">
      <button
        type="button"
        data-testid="execution-status-badge"
        data-attention={state()}
        class="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-13-regular text-v2-text-text-muted hover:text-v2-text-text-base"
        onClick={props.onOpen}
        aria-label={language.t("execution.status.open")}
      >
        <span data-testid="execution-status-icon" class="shrink-0">
          <Icon name={STATE_ICONS[state()]} size="small" />
        </span>
        <span data-testid="execution-status-label" class="max-md:hidden">
          {statusLabel()}
        </span>
      </button>
      <Show when={state() === "needs_input"}>
        <button
          type="button"
          class="shrink-0 whitespace-nowrap rounded-md px-2 text-13-regular text-v2-text-text-muted hover:text-v2-text-text-base"
          onClick={() => props.model.reviewRequest()}
        >
          {language.t("execution.status.reviewRequest")}
        </button>
      </Show>
      <span role="status" class="sr-only">
        {statusLabel()}
      </span>
    </div>
  )
}

function statusKey(state: ExecutionAttentionState) {
  if (state === "stale") return "execution.status.stale" as const
  if (state === "needs_input") return "execution.status.needs_input" as const
  if (state === "failed") return "execution.status.failed" as const
  if (state === "blocked") return "execution.status.blocked" as const
  return "execution.status.normal" as const
}
