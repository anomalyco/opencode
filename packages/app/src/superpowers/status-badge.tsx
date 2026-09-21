import { Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
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
  const attention = () => props.model.attention()
  const state = () => attentionState(attention())
  const activeAgents = () => props.model.agents().filter((agent) => agent.state === "running").length
  const summary = () => {
    const current = state()
    if (current === "stale") return language.t("execution.status.stale")
    if (current === "needs_input") return language.t("execution.status.needs_input")
    if (current === "failed") return language.t("execution.status.failed")
    if (current === "blocked") return language.t("execution.status.blocked")
    const progress = props.model.progress()
    if (progress) return language.t("execution.status.verified", { verified: progress.verified, total: progress.total })
    if (activeAgents() > 0) return language.plural("execution.status.activeAgents", activeAgents())
    return language.t("execution.status.normal")
  }
  const liveMessage = () => {
    const current = state()
    if (current === "stale") return language.t("execution.status.stale")
    if (current === "needs_input") return language.t("execution.status.needs_input")
    if (current === "failed") return language.t("execution.status.failed")
    if (current === "blocked") return language.t("execution.status.blocked")
    return ""
  }

  return (
    <div class="flex items-center gap-1">
      <Tooltip
        class="shrink-0"
        placement="bottom"
        value={
          <div class="flex flex-col gap-0.5" data-testid="execution-status-detail">
            <span>{language.t("execution.status.detail.title")}</span>
            <span>
              {attention().stale
                ? language.t("execution.status.detail.stale")
                : language.t("execution.status.detail.connected")}
            </span>
            <span>{language.plural("execution.status.detail.needsInput", attention().needsInput)}</span>
            <span>{language.plural("execution.status.detail.failed", attention().failed)}</span>
            <span>{language.plural("execution.status.detail.blocked", attention().blocked)}</span>
            <Show when={props.model.progress()}>
              {(progress) => (
                <span>
                  {language.t("execution.status.detail.verified", {
                    verified: progress().verified,
                    total: progress().total,
                  })}
                </span>
              )}
            </Show>
            <span>{language.plural("execution.status.detail.agents", activeAgents())}</span>
          </div>
        }
      >
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
            {summary()}
          </span>
        </button>
      </Tooltip>
      <Show when={state() === "needs_input"}>
        <button
          type="button"
          class="shrink-0 whitespace-nowrap rounded-md px-2 text-13-regular text-v2-text-text-muted hover:text-v2-text-text-base"
          onClick={() => props.model.reviewRequest()}
        >
          {language.t("execution.status.reviewRequest")}
        </button>
      </Show>
      <span role="status" data-testid="execution-status-live" class="sr-only">
        {liveMessage()}
      </span>
    </div>
  )
}
