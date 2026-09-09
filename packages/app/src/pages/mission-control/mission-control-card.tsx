import { DiffChanges } from "@opencode-ai/ui/v2/diff-changes-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createMemo, Show } from "solid-js"
import { SessionTabAvatarView } from "@/pages/layout/session-tab-avatar"
import { sessionTitle } from "@/utils/session-title"
import type { MissionControlController, MissionControlRecord } from "./mission-control-controller"
import { formatAgentAge, formatUsage, type MissionControlStatus } from "./mission-control-model"

export const STATUS_META: Record<MissionControlStatus, { label: string; tone: string; dot: string }> = {
  attention: { label: "Needs you", tone: "text-v2-state-fg-warning", dot: "bg-v2-state-fg-warning" },
  working: { label: "Working", tone: "text-v2-state-fg-info", dot: "bg-v2-state-fg-info" },
  ready: { label: "Ready", tone: "text-v2-state-fg-success", dot: "bg-v2-state-fg-success" },
  idle: { label: "Idle", tone: "text-v2-text-text-faint", dot: "bg-v2-border-border-strong" },
}

type CardProps = {
  controller: MissionControlController
  record: MissionControlRecord
  selected: boolean
}

export function MissionControlCard(props: CardProps) {
  const meta = () => STATUS_META[props.record.status]
  const busy = () => props.record.status === "working"
  const changes = createMemo(() =>
    props.record.diffs.map((diff) => ({ additions: diff.additions ?? 0, deletions: diff.deletions ?? 0 })),
  )
  const runtime = () => [props.record.agent, props.record.model].filter(Boolean).join(" · ")

  return (
    <div
      data-component="mission-control-card"
      data-status={props.record.status}
      role="option"
      aria-selected={props.selected}
      tabIndex={-1}
      class="group/card flex min-w-0 cursor-default flex-col gap-2 rounded-[8px] border px-3.5 py-3 transition-[background-color,border-color] duration-[120ms] ease-in-out"
      classList={{
        "border-transparent hover:bg-v2-overlay-simple-overlay-hover": !props.selected,
        "border-v2-border-border-focus bg-v2-overlay-simple-overlay-hover": props.selected,
      }}
      onClick={() => props.controller.selection.select(props.record)}
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex size-4 shrink-0 items-center justify-center">
          <SessionTabAvatarView
            project={props.record.project}
            directory={props.record.session.directory}
            revealProjectOnHover={false}
            unread={props.record.status === "attention"}
            loading={busy()}
          />
        </span>
        <span class="min-w-0 flex-1 truncate text-[14px] leading-5 tracking-[-0.05px] text-v2-text-text-strong [font-weight:560]">
          {sessionTitle(props.record.session.title) || props.record.session.id}
        </span>
        <span class={`flex shrink-0 items-center gap-1 text-[12px] leading-4 [font-weight:530] ${meta().tone}`}>
          <span aria-hidden="true" class={`size-1.5 rounded-full ${meta().dot}`} />
          {formatAgentAge(props.controller.data.now() - props.record.activityAt)}
        </span>
      </div>

      <div class="flex min-w-0 items-start gap-2 ps-6">
        <p
          class="min-w-0 flex-1 truncate text-[13px] leading-5 text-v2-text-text-base [font-weight:440]"
          classList={{ "text-v2-state-fg-danger": props.record.failed }}
        >
          {props.record.step}
        </p>
        <CardAction controller={props.controller} record={props.record} />
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0 ps-6 text-[12px] leading-4 text-v2-text-text-muted [font-weight:440]">
        <span class="max-w-[120px] truncate">{props.record.projectName}</span>
        <Show when={props.record.branch}>
          <span aria-hidden="true">·</span>
          <span class="max-w-[100px] truncate">{props.record.branch}</span>
        </Show>
        <Show when={props.record.worktree}>
          <span aria-hidden="true">·</span>
          <span class="max-w-[100px] truncate">{props.record.worktree}</span>
        </Show>
        <Show when={runtime()}>
          <span aria-hidden="true">·</span>
          <span class="max-w-[130px] truncate">{runtime()}</span>
        </Show>
        <Show when={props.record.cost > 0 || props.record.tokens > 0}>
          <span aria-hidden="true">·</span>
          <span class="shrink-0">{formatUsage(props.record.cost, props.record.tokens)}</span>
        </Show>
        <Show when={changes().length > 0}>
          <span aria-hidden="true">·</span>
          <DiffChanges class="shrink-0" changes={changes()} />
        </Show>
      </div>
    </div>
  )
}

function CardAction(props: { controller: MissionControlController; record: MissionControlRecord }) {
  return (
    <Show
      when={props.record.status !== "attention" || !props.record.permission}
      fallback={
        <div class="flex shrink-0 items-center gap-1">
          <ButtonV2
            size="small"
            variant="ghost-muted"
            onClick={(event: MouseEvent) => {
              event.stopPropagation()
              void props.controller.action.decide(props.record, "reject")
            }}
          >
            Deny
          </ButtonV2>
          <ButtonV2
            size="small"
            variant="neutral"
            onClick={(event: MouseEvent) => {
              event.stopPropagation()
              void props.controller.action.decide(props.record, "once")
            }}
          >
            Allow
          </ButtonV2>
        </div>
      }
    >
      <Show when={props.record.status === "working"}>
        <ButtonV2
          size="small"
          variant="ghost-muted"
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            void props.controller.action.interrupt(props.record)
          }}
        >
          Stop
        </ButtonV2>
      </Show>
      <Show when={props.record.status === "attention" && !props.record.permission}>
        <ButtonV2
          size="small"
          variant="neutral"
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            props.controller.action.reply(props.record)
          }}
        >
          {props.record.question ? "Reply" : "Inspect"}
        </ButtonV2>
      </Show>
      <Show when={props.record.status === "ready"}>
        <ButtonV2
          size="small"
          variant="neutral"
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            props.controller.action.review(props.record)
          }}
        >
          Review
        </ButtonV2>
      </Show>
    </Show>
  )
}
