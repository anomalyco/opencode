import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { For, Show, createMemo } from "solid-js"
import { EmbeddedSessionPage } from "@/pages/session"
import type { EmbeddedSessionView } from "@/pages/session/embedded-session-view"
import { SessionTabAvatarView } from "@/pages/layout/session-tab-avatar"
import { sessionTitle } from "@/utils/session-title"
import { STATUS_META } from "./mission-control-card"
import type {
  MissionControlController,
  MissionControlDetailTab,
  MissionControlRecord,
} from "./mission-control-controller"
import { formatAgentAge, formatUsage } from "./mission-control-model"

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "conversation", label: "Conversation" },
  { id: "changes", label: "Changes" },
  { id: "context", label: "Context" },
] as const satisfies readonly { id: MissionControlDetailTab; label: string }[]

export function MissionControlDetail(props: {
  controller: MissionControlController
  record: MissionControlRecord
  tab: () => MissionControlDetailTab
  onTabChange: (tab: MissionControlDetailTab) => void
}) {
  const meta = () => STATUS_META[props.record.status]
  const title = () => sessionTitle(props.record.session.title) || props.record.session.id
  const runtime = () => [props.record.agent, props.record.model].filter(Boolean).join(" · ")
  const usage = () => formatUsage(props.record.cost, props.record.tokens)
  const embeddedView = (): EmbeddedSessionView => {
    const tab = props.tab()
    if (tab === "changes" || tab === "context") return tab
    return "conversation"
  }

  return (
    <aside aria-label="Agent task detail" class="flex min-h-0 min-w-0 flex-1 flex-col bg-v2-background-bg-base">
      <header class="flex shrink-0 items-start gap-3 border-b border-v2-border-border-muted px-6 py-5">
        <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-v2-background-bg-layer-02">
          <SessionTabAvatarView
            project={props.record.project}
            directory={props.record.session.directory}
            revealProjectOnHover={false}
            unread={props.record.status === "attention"}
            loading={props.record.status === "working"}
          />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 class="truncate text-[17px] leading-6 tracking-[-0.12px] text-v2-text-text-strong [font-weight:580]">
            {title()}
          </h2>
          <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-4 text-v2-text-text-muted [font-weight:440]">
            <span class="max-w-[180px] truncate">{props.record.projectName}</span>
            <Show when={props.record.branch}>
              <span aria-hidden="true">·</span>
              <span class="flex min-w-0 items-center gap-1">
                <IconV2 name="branch" size="small" class="shrink-0" />
                <span class="max-w-[180px] truncate">{props.record.branch}</span>
              </span>
            </Show>
            <Show when={props.record.worktree}>
              <span aria-hidden="true">·</span>
              <span class="max-w-[150px] truncate">{props.record.worktree}</span>
            </Show>
          </div>
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 [font-weight:440]">
            <span class={`flex items-center gap-1 [font-weight:530] ${meta().tone}`}>
              <span aria-hidden="true" class={`size-1.5 rounded-full ${meta().dot}`} />
              {meta().label}
            </span>
            <span class="text-v2-text-text-faint">{`Started ${formatAgentAge(props.controller.data.now() - props.record.session.time.created)} ago`}</span>
            <Show when={runtime()}>
              <span aria-hidden="true" class="text-v2-text-text-faint">
                ·
              </span>
              <span class="max-w-[220px] truncate text-v2-text-text-muted">{runtime()}</span>
            </Show>
            <Show when={usage()}>
              <span aria-hidden="true" class="text-v2-text-text-faint">
                ·
              </span>
              <span class="text-v2-text-text-muted">{usage()}</span>
            </Show>
          </div>
        </div>
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="large"
          icon={<IconV2 name="outline-square-arrow" />}
          aria-label="Open full task"
          onClick={() => props.controller.action.open(props.record)}
        />
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="large"
          icon={<IconV2 name="close" />}
          aria-label="Close task detail"
          onClick={props.controller.selection.clear}
        />
      </header>

      <nav
        role="tablist"
        aria-label="Task detail views"
        class="flex h-12 shrink-0 border-b border-v2-border-border-muted px-6"
      >
        <For each={TABS}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              id={`mission-control-${tab.id}-tab`}
              aria-selected={props.tab() === tab.id}
              aria-controls={`mission-control-${tab.id}-panel`}
              class="relative flex h-full items-center px-3 text-[13px] leading-4 text-v2-text-text-muted [font-weight:500] outline-none hover:text-v2-text-text-base focus-visible:ring-2 focus-visible:ring-v2-border-border-focus focus-visible:ring-inset"
              classList={{ "text-v2-text-text-strong [font-weight:560]": props.tab() === tab.id }}
              onClick={() => props.onTabChange(tab.id)}
            >
              {tab.label}
              <Show when={tab.id === "changes" && props.record.filesChanged > 0}>
                <span class="ms-1 text-v2-text-text-faint">{props.record.filesChanged}</span>
              </Show>
              <Show when={props.tab() === tab.id}>
                <span aria-hidden="true" class="absolute inset-x-3 bottom-0 h-px bg-v2-text-text-strong" />
              </Show>
            </button>
          )}
        </For>
      </nav>

      <div
        role="tabpanel"
        id={`mission-control-${props.tab()}-panel`}
        aria-labelledby={`mission-control-${props.tab()}-tab`}
        class="min-h-0 flex-1 overflow-hidden"
      >
        <Show
          when={props.tab() !== "summary"}
          fallback={<MissionControlSummary controller={props.controller} record={props.record} />}
        >
          <EmbeddedSessionPage
            server={props.record.server}
            directory={props.record.session.directory}
            sessionID={props.record.session.id}
            view={embeddedView()}
            onViewChange={props.onTabChange}
          />
        </Show>
      </div>

      <footer class="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-v2-border-border-muted px-5 py-3.5">
        <Show
          when={props.record.permission}
          fallback={
            <Show when={props.record.filesChanged > 0 && props.tab() !== "changes"}>
              <ButtonV2 size="large" variant="contrast" icon="review" onClick={() => props.onTabChange("changes")}>
                Review changes
              </ButtonV2>
            </Show>
          }
        >
          <ButtonV2
            size="large"
            variant="contrast"
            onClick={() => void props.controller.action.decide(props.record, "once")}
          >
            Allow
          </ButtonV2>
          <ButtonV2
            size="large"
            variant="warning"
            onClick={() => void props.controller.action.decide(props.record, "reject")}
          >
            Deny
          </ButtonV2>
        </Show>
        <ButtonV2
          size="large"
          variant={props.record.filesChanged === 0 && !props.record.permission ? "contrast" : "neutral"}
          onClick={() => props.controller.action.reply(props.record)}
        >
          Message agent
        </ButtonV2>
        <Show when={props.record.status === "working"}>
          <ButtonV2
            size="large"
            variant="neutral"
            icon="stop"
            onClick={() => void props.controller.action.interrupt(props.record)}
          >
            Stop agent
          </ButtonV2>
        </Show>
        <div class="min-w-2 flex-1" />
        <ButtonV2
          class="shrink-0"
          size="large"
          variant="ghost-muted"
          icon="outline-square-arrow"
          onClick={() => props.controller.action.open(props.record)}
        >
          Open task
        </ButtonV2>
      </footer>
    </aside>
  )
}

function MissionControlSummary(props: { controller: MissionControlController; record: MissionControlRecord }) {
  const files = createMemo(() => props.record.diffs.slice(0, 5))
  const totalLines = () => props.record.additions + props.record.deletions
  const additionShare = () => (totalLines() === 0 ? 50 : (props.record.additions / totalLines()) * 100)

  return (
    <ScrollView class="size-full">
      <div class="mx-auto flex w-full max-w-[880px] flex-col gap-7 px-7 py-6">
        <section class="flex flex-col gap-2.5">
          <SectionLabel>Currently</SectionLabel>
          <div class="flex min-w-0 items-center gap-3 rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-4 py-3">
            <span aria-hidden="true" class={`size-2 shrink-0 rounded-full ${STATUS_META[props.record.status].dot}`} />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate text-[14px] leading-5 text-v2-text-text-strong [font-weight:560]">
                {props.record.step}
              </span>
              <span class="text-[12px] leading-4 text-v2-text-text-muted [font-weight:440]">
                {STATUS_META[props.record.status].label}
              </span>
            </div>
            <Show when={props.record.branch}>
              <span class="max-w-[180px] truncate rounded-[5px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 py-1 text-[11px] leading-4 text-v2-text-text-muted [font-weight:440]">
                {props.record.branch}
              </span>
            </Show>
          </div>
        </section>

        <section class="flex flex-col gap-2.5">
          <SectionLabel>Plan</SectionLabel>
          <Show
            when={props.record.todos.length > 0}
            fallback={
              <p class="rounded-[8px] border border-dashed border-v2-border-border-muted px-4 py-3 text-[13px] leading-5 text-v2-text-text-muted [font-weight:440]">
                No plan has been published for this task yet.
              </p>
            }
          >
            <div class="flex flex-col gap-1">
              <For each={props.record.todos}>
                {(todo) => (
                  <div class="flex min-w-0 items-center gap-3 rounded-[6px] px-2 py-1.5">
                    <TodoStatus status={todo.status} />
                    <span
                      class="min-w-0 flex-1 truncate text-[13px] leading-5 text-v2-text-text-muted [font-weight:440]"
                      classList={{
                        "text-v2-text-text-base [font-weight:530]": todo.status === "in_progress",
                        "line-through opacity-60": todo.status === "cancelled",
                      }}
                    >
                      {todo.content}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="flex flex-col gap-2.5">
          <SectionLabel>Changes</SectionLabel>
          <div class="overflow-hidden rounded-[8px] border border-v2-border-border-muted">
            <div class="grid grid-cols-3 border-b border-v2-border-border-muted bg-v2-background-bg-layer-01">
              <ChangeMetric value={props.record.filesChanged} label="Files changed" />
              <ChangeMetric value={`+${props.record.additions}`} label="Insertions" tone="success" />
              <ChangeMetric value={`-${props.record.deletions}`} label="Deletions" tone="danger" />
            </div>
            <Show
              when={props.record.filesChanged > 0}
              fallback={
                <p class="px-4 py-5 text-center text-[12px] leading-5 text-v2-text-text-faint [font-weight:440]">
                  No file changes recorded yet.
                </p>
              }
            >
              <div class="flex h-1 w-full bg-v2-background-bg-layer-02">
                <div
                  class="h-full bg-v2-state-fg-success"
                  style={{ width: `${additionShare()}%` }}
                  aria-hidden="true"
                />
                <div class="h-full flex-1 bg-v2-state-fg-danger" aria-hidden="true" />
              </div>
              <div class="flex flex-col px-4 py-3">
                <For each={files()}>
                  {(diff) => (
                    <button
                      type="button"
                      class="flex min-w-0 items-center gap-3 rounded-[5px] px-1 py-1.5 text-start hover:bg-v2-overlay-simple-overlay-hover"
                      onClick={() => props.controller.action.review(props.record)}
                    >
                      <span class="min-w-0 flex-1 truncate text-[13px] leading-5 text-v2-text-text-muted [font-weight:440]">
                        {diff.file}
                      </span>
                      <span class="shrink-0 text-[11px] leading-4 text-v2-state-fg-success [font-weight:530]">
                        {`+${diff.additions ?? 0}`}
                      </span>
                      <span class="shrink-0 text-[11px] leading-4 text-v2-state-fg-danger [font-weight:530]">
                        {`-${diff.deletions ?? 0}`}
                      </span>
                    </button>
                  )}
                </For>
                <Show when={props.record.filesChanged > files().length}>
                  <button
                    type="button"
                    class="self-start rounded-[5px] px-1 py-1.5 text-[11px] leading-4 text-v2-text-text-faint [font-weight:440] hover:text-v2-text-text-base"
                    onClick={() => props.controller.action.review(props.record)}
                  >
                    {`+ ${props.record.filesChanged - files().length} more ${props.record.filesChanged - files().length === 1 ? "file" : "files"}`}
                  </button>
                </Show>
              </div>
            </Show>
          </div>
        </section>
      </div>
    </ScrollView>
  )
}

function SectionLabel(props: { children: string }) {
  return (
    <h3 class="text-[11px] leading-4 tracking-[0.08em] text-v2-text-text-muted uppercase [font-weight:620]">
      {props.children}
    </h3>
  )
}

function ChangeMetric(props: { value: number | string; label: string; tone?: "success" | "danger" }) {
  return (
    <div class="flex min-w-0 flex-col items-center gap-0.5 border-e border-v2-border-border-muted px-3 py-3 last:border-e-0">
      <span
        class="text-[18px] leading-6 text-v2-text-text-strong [font-weight:580]"
        classList={{
          "text-v2-state-fg-success": props.tone === "success",
          "text-v2-state-fg-danger": props.tone === "danger",
        }}
      >
        {props.value}
      </span>
      <span class="truncate text-[11px] leading-4 text-v2-text-text-muted [font-weight:440]">{props.label}</span>
    </div>
  )
}

function TodoStatus(props: { status: string }) {
  return (
    <span
      aria-hidden="true"
      class="flex size-4 shrink-0 items-center justify-center rounded-full border border-v2-border-border-strong"
      classList={{
        "border-v2-state-fg-success text-v2-state-fg-success": props.status === "completed",
        "border-v2-state-fg-info": props.status === "in_progress",
      }}
    >
      <Show when={props.status === "completed"}>
        <IconV2 name="check" size="small" class="size-3" />
      </Show>
      <Show when={props.status === "in_progress"}>
        <span class="size-1.5 rounded-full bg-v2-state-fg-info" />
      </Show>
    </span>
  )
}
