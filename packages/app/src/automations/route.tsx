import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, For, Show } from "solid-js"
import { sessionTitle } from "@/session/title"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { CollapsedSidebarToggleSpace } from "@/shell/sidebar-toggle"
import {
  type AutomationFilter,
  automationKind,
  formatAutomationWhen,
  formatConditionGuard,
  formatConditionSummary,
  formatRelativeTime,
} from "./format"
import { type AutomationEntry, createAutomationsController } from "./model"

const STARTER_RECIPES = [
  {
    label: "Watch PR checks until green",
    prompt: "/automate check `gh pr checks` every 30s until it exits 0, then summarize any slow jobs",
  },
  {
    label: "Weekday 9 AM standup brief",
    prompt: "/automate every weekday at 9:00 AM summarize recent commits and open PRs in this repo",
  },
  {
    label: "Wake when test output changes",
    prompt: "/automate run `bun test` every 2m and wake me if stdout changes",
  },
] as const

export function AutomationsScreen() {
  const controller = createAutomationsController()
  const dialog = useDialog()
  const language = controller.language

  const filters = createMemo(
    (): { id: AutomationFilter; label: string; count: number }[] => [
      { id: "all", label: language.t("automations.filter.all"), count: controller.counts().all },
      { id: "active", label: language.t("automations.filter.active"), count: controller.counts().active },
      { id: "paused", label: language.t("automations.filter.paused"), count: controller.counts().paused },
      { id: "done", label: language.t("automations.filter.done"), count: controller.counts().done },
    ],
  )

  function confirmDelete(entry: AutomationEntry) {
    const name = controller.titleFor(entry)
    void dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("automations.delete.title")}
            description={language.t("automations.delete.confirm", { name })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" autofocus onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              void controller.remove(entry)
              dialog.close()
            }}
          >
            {language.t("automations.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  }

  return (
    <div
      data-slot="automations-panel"
      class="mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
    >
      <div
        data-slot="automations-header"
        data-tauri-drag-region
        class="flex h-12 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-2.5"
      >
        <CollapsedSidebarToggleSpace />
        <div class="flex min-w-0 items-center gap-2">
          <Icon name="clock" class="shrink-0 text-v2-icon-icon-muted" />
          <h1 class="truncate text-[14px] leading-5 font-medium text-v2-text-text-base">
            {language.t("automations.title")}
          </h1>
        </div>

        <div
          role="tablist"
          aria-label={language.t("automations.title")}
          class="ms-2 hidden items-center gap-0.5 rounded-[7px] bg-v2-background-bg-layer-01 p-0.5 sm:flex"
        >
          <For each={filters()}>
            {(item) => {
              const active = () => controller.filter() === item.id

              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active()}
                  data-filter={item.id}
                  data-state={active() ? "active" : undefined}
                  class="flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[12px] leading-4 text-v2-text-text-muted transition-colors hover:text-v2-text-text-base data-[state=active]:bg-v2-background-bg-layer-02 data-[state=active]:font-medium data-[state=active]:text-v2-text-text-base"
                  onClick={() => controller.setFilter(item.id)}
                >
                  <span>{item.label}</span>
                  <Show when={item.count > 0}>
                    <span class="tabular-nums text-v2-text-text-faint">{item.count}</span>
                  </Show>
                </button>
              )
            }}
          </For>
        </div>

        <div class="ms-auto flex items-center gap-1.5">
          <div class="relative hidden w-48 items-center md:flex lg:w-60">
            <Icon
              name="magnifying-glass"
              size="small"
              class="pointer-events-none absolute start-2 text-v2-icon-icon-muted"
            />
            <input
              type="search"
              value={controller.query()}
              onInput={(event) => controller.setQuery(event.currentTarget.value)}
              placeholder={language.t("automations.search")}
              aria-label={language.t("automations.search")}
              class="h-7 w-full rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 ps-7 pe-2 text-[12px] leading-4 text-v2-text-text-base placeholder:text-v2-text-text-faint focus:border-v2-border-border-strong focus:outline-none"
            />
          </div>

          <Tooltip placement="bottom" value={language.t("automations.refresh")}>
            <IconButton
              type="button"
              variant="ghost-muted"
              size="normal"
              icon={<Icon name="refresh" size="small" />}
              aria-label={language.t("automations.refresh")}
              onClick={controller.refresh}
            />
          </Tooltip>

          <Button
            type="button"
            variant="contrast"
            size="small"
            data-action="automations-new"
            onClick={() => controller.openNewAutomation()}
          >
            <Icon name="plus-small" size="small" />
            <span>{language.t("automations.new")}</span>
          </Button>
        </div>
      </div>

      <Show
        when={controller.entries().length > 0}
        fallback={<AutomationsEmpty loading={controller.loading()} onPick={(prompt) => controller.openNewAutomation(prompt)} />}
      >
        <div class="grid min-h-0 flex-1 grid-cols-1 divide-y divide-v2-border-border-base lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
          <ScrollView class="min-h-0">
            <div class="flex flex-col gap-0.5 p-2">
              <Show
                when={controller.filtered().length > 0}
                fallback={
                  <div class="px-3 py-8 text-center text-[13px] leading-5 text-v2-text-text-faint">
                    {language.t("automations.empty.filtered")}
                  </div>
                }
              >
                <For each={controller.filtered()}>
                  {(entry) => (
                    <AutomationListRow
                      entry={entry}
                      selected={controller.selected()?.key === entry.key}
                      now={controller.now()}
                      multiServer={controller.multiServer()}
                      title={controller.titleFor(entry)}
                      onSelect={() => controller.select(entry.key)}
                    />
                  )}
                </For>
              </Show>
            </div>
          </ScrollView>

          <ScrollView class="min-h-0">
            <Show when={controller.selected()}>
              {(entry) => (
                <AutomationInspector
                  entry={entry()}
                  now={controller.now()}
                  multiServer={controller.multiServer()}
                  busy={controller.busy(entry().key)}
                  title={controller.titleFor(entry())}
                  onTogglePause={() => void controller.togglePause(entry())}
                  onOpenSession={() => controller.openSession(entry())}
                  onDelete={() => confirmDelete(entry())}
                />
              )}
            </Show>
          </ScrollView>
        </div>
      </Show>
    </div>
  )
}

function AutomationListRow(props: {
  entry: AutomationEntry
  selected: boolean
  now: number
  multiServer: boolean
  title: string
  onSelect: () => void
}) {
  const schedule = () => props.entry.schedule
  const kind = () => automationKind(schedule())

  const project = createMemo(() =>
    props.entry.session ? props.entry.ctx.projects.forSession(props.entry.session) : undefined,
  )

  const badgeText = () => {
    const item = schedule()

    if (item.status === "active") {
      return item.nextDueAt !== undefined ? formatRelativeTime(item.nextDueAt, props.now) : "active"
    }

    if (item.status === "paused") return item.lastOutcome === "failed" ? "failed" : "paused"

    return item.lastOutcome === "expired" ? "timed out" : "done"
  }

  const subline = () => {
    const item = schedule()
    const summary = formatConditionSummary(item) ?? formatAutomationWhen(item.when)

    const place =
      props.entry.projectName ??
      (props.entry.session ? sessionTitle(props.entry.session.title) : undefined) ??
      (props.multiServer ? props.entry.serverLabel : undefined)

    return place ? `${place} · ${summary}` : summary
  }

  return (
    <button
      type="button"
      data-slot="automation-row"
      data-automation-id={schedule().id}
      data-status={schedule().status}
      data-state={props.selected ? "active" : undefined}
      onClick={props.onSelect}
      class="group flex w-full flex-col gap-1 rounded-[7px] px-2.5 py-2 text-start transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none data-[state=active]:bg-v2-background-bg-layer-02"
    >
      <div class="flex w-full min-w-0 items-center gap-2">
        <StatusDot schedule={schedule()} />
        <span class="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium text-v2-text-text-base">
          {props.title}
        </span>
        <span
          class="shrink-0 tabular-nums text-[11px] leading-4"
          classList={{
            "text-v2-state-fg-success font-medium":
              schedule().status === "active" && schedule().lastOutcome !== "failed",
            "text-v2-state-fg-warning":
              (schedule().status === "active" && schedule().lastOutcome === "failed") ||
              (schedule().status === "done" && schedule().lastOutcome === "expired"),
            "text-v2-state-fg-danger": schedule().status === "paused" && schedule().lastOutcome === "failed",
            "text-v2-text-text-faint":
              (schedule().status === "paused" && schedule().lastOutcome !== "failed") ||
              (schedule().status === "done" && schedule().lastOutcome !== "expired"),
          }}
        >
          {badgeText()}
        </span>
      </div>

      <div class="flex w-full min-w-0 items-center gap-1.5 ps-4 text-[12px] leading-4 text-v2-text-text-faint">
        <Show when={props.entry.session}>
          {(session) => (
            <span class="flex size-3.5 shrink-0 items-center justify-center">
              <SessionTabAvatarView
                project={project()}
                directory={session().location.directory}
                unread={false}
              />
            </span>
          )}
        </Show>
        <KindPill kind={kind()} />
        <span class="min-w-0 flex-1 truncate font-mono text-[11px]">{subline()}</span>
      </div>
    </button>
  )
}

function StatusDot(props: { schedule: AutomationEntry["schedule"] }) {
  const status = () => props.schedule.status
  const failed = () => props.schedule.lastOutcome === "failed"
  const expired = () => props.schedule.lastOutcome === "expired"

  return (
    <span
      aria-hidden="true"
      class="size-2 shrink-0 rounded-full"
      classList={{
        "bg-emerald-500": status() === "active" && !failed(),
        "bg-amber-500": (status() === "active" && failed()) || (status() === "done" && expired()),
        "bg-rose-500": status() === "paused" && failed(),
        "border border-v2-border-border-strong bg-transparent": status() === "paused" && !failed(),
        "bg-v2-text-text-faint opacity-50": status() === "done" && !expired(),
      }}
    />
  )
}

const KIND_LABELS: Record<"until" | "if" | "schedule", string> = {
  until: "until",
  if: "if",
  schedule: "timer",
}

function KindPill(props: { kind: "until" | "if" | "schedule" }) {
  return (
    <span
      class="shrink-0 rounded px-1 py-px text-[10px] leading-3.5 font-medium uppercase tracking-wide"
      classList={{
        "bg-sky-500/12 text-v2-state-fg-info": props.kind === "until",
        "bg-amber-500/12 text-v2-state-fg-warning": props.kind === "if",
        "bg-v2-background-bg-layer-01 text-v2-text-text-muted": props.kind === "schedule",
      }}
    >
      {KIND_LABELS[props.kind]}
    </span>
  )
}

function AutomationInspector(props: {
  entry: AutomationEntry
  now: number
  multiServer: boolean
  busy: boolean
  title: string
  onTogglePause: () => void
  onOpenSession: () => void
  onDelete: () => void
}) {
  const schedule = () => props.entry.schedule
  const condition = () => schedule().until ?? schedule().if

  const conditionMode = () => {
    if (schedule().until !== undefined) return "until"

    if (schedule().if !== undefined) return "if"

    return undefined
  }

  const sessionLabel = () => {
    const s = props.entry.session

    if (s) return sessionTitle(s.title) ?? s.id.slice(0, 12)

    return schedule().sessionID?.slice(0, 12)
  }

  const statusText = () => {
    const item = schedule()

    if (item.status === "active") return "Active"

    if (item.status === "paused") return item.lastOutcome === "failed" ? "Paused (check failed)" : "Paused"

    return item.lastOutcome === "expired" ? "Timed out" : "Completed"
  }

  const nextRunText = () => {
    const item = schedule()

    if (item.status !== "active" || item.nextDueAt === undefined) return "—"
    const clock = new Date(item.nextDueAt).toLocaleTimeString(undefined, { timeStyle: "short" })

    return `${formatRelativeTime(item.nextDueAt, props.now)} (${clock})`
  }

  const runsText = () => {
    const item = schedule()

    if (item.remainingRuns !== undefined && item.status !== "done") {
      return `${item.runCount} completed · ${item.remainingRuns} remaining`
    }

    return `${item.runCount} completed`
  }

  const lastCheckText = () => {
    const item = schedule()

    if (!item.lastOutcome && item.lastFiredAt === undefined) return "Not checked yet"
    const ago = item.lastFiredAt !== undefined ? ` ${formatRelativeTime(item.lastFiredAt, props.now)}` : ""

    return `${item.lastOutcome ?? "ran"}${ago}`
  }

  return (
    <div data-slot="automation-inspector" class="mx-auto flex w-full max-w-[760px] flex-col gap-5 p-5 lg:p-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex items-center gap-2">
            <StatusDot schedule={schedule()} />
            <span class="text-[12px] leading-4 font-medium text-v2-text-text-muted">{statusText()}</span>
            <Show when={props.entry.projectName}>
              {(project) => (
                <>
                  <span class="text-v2-text-text-faint">·</span>
                  <span class="truncate text-[12px] leading-4 text-v2-text-text-muted">{project()}</span>
                </>
              )}
            </Show>
            <Show when={props.multiServer}>
              <span class="text-v2-text-text-faint">·</span>
              <span class="truncate text-[12px] leading-4 text-v2-text-text-faint">{props.entry.serverLabel}</span>
            </Show>
          </div>
          <h2 class="text-[16px] leading-6 font-semibold text-v2-text-text-base">{props.title}</h2>
          <Show when={sessionLabel()}>
            {(name) => (
              <div class="flex items-center gap-1.5 text-[12px] leading-4 text-v2-text-text-faint">
                <span>Session: {name()}</span>
                <span class="font-mono text-[11px] opacity-75">({schedule().id})</span>
              </div>
            )}
          </Show>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          <Show when={schedule().sessionID}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              data-action="automation-open-session"
              onClick={props.onOpenSession}
            >
              <span>Open session</span>
              <Icon name="arrow-up-right" size="small" />
            </Button>
          </Show>

          <Show when={schedule().status !== "done"}>
            <Button
              type="button"
              variant="neutral"
              size="small"
              disabled={props.busy}
              data-action="automation-toggle-pause"
              onClick={props.onTogglePause}
            >
              {schedule().status === "paused" ? "Resume" : "Pause"}
            </Button>
          </Show>

          <Tooltip placement="bottom" value="Delete automation">
            <IconButton
              type="button"
              variant="ghost-muted"
              size="normal"
              disabled={props.busy}
              data-action="automation-delete"
              aria-label="Delete automation"
              icon={<Icon name="trash" size="small" />}
              onClick={props.onDelete}
            />
          </Tooltip>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2.5 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3 sm:grid-cols-4">
        <FactCell label="Trigger" value={`${formatAutomationWhen(schedule().when)}`} sub={schedule().tz} />
        <FactCell label="Next run" value={nextRunText()} />
        <FactCell label="Runs" value={runsText()} />
        <FactCell label="Last check" value={lastCheckText()} />
      </div>

      <Show when={condition()}>
        {(cond) => (
          <section class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-[12px] leading-4 font-medium text-v2-text-text-muted">
                {conditionMode() === "until" ? "One-shot watch (until · zero tokens)" : "Recurring gate (if · zero tokens)"}
              </h3>
              <Show when={formatConditionGuard(cond())}>
                {(guard) => <span class="text-[11px] leading-4 text-v2-text-text-faint">{guard()}</span>}
              </Show>
            </div>
            <pre class="overflow-x-auto rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3 font-mono text-[12px] leading-5 text-v2-text-text-base select-text">
              {(() => {
                const c = cond()

                return c.type === "shell" ? `$ ${c.run}` : c.code
              })()}
            </pre>
          </section>
        )}
      </Show>

      <section class="flex flex-col gap-1.5">
        <h3 class="text-[12px] leading-4 font-medium text-v2-text-text-muted">Wake prompt</h3>
        <div class="whitespace-pre-wrap rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3 text-[13px] leading-5 text-v2-text-text-base select-text">
          {schedule().action.prompt}
        </div>
      </section>

      <Show when={schedule().lastOutput}>
        {(output) => (
          <section class="flex flex-col gap-1.5">
            <h3 class="text-[12px] leading-4 font-medium text-v2-text-text-muted">Latest check output</h3>
            <pre class="max-h-56 overflow-auto rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3 font-mono text-[12px] leading-5 text-v2-text-text-muted select-text">
              {output()}
            </pre>
          </section>
        )}
      </Show>
    </div>
  )
}

function FactCell(props: { label: string; value: string; sub?: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-[11px] leading-4 text-v2-text-text-faint">{props.label}</span>
      <span class="truncate text-[12px] leading-4 font-medium text-v2-text-text-base">{props.value}</span>
      <Show when={props.sub}>
        {(sub) => <span class="truncate text-[11px] leading-4 text-v2-text-text-faint">{sub()}</span>}
      </Show>
    </div>
  )
}

function AutomationsEmpty(props: { loading: boolean; onPick: (prompt: string) => void }) {
  return (
    <div class="mx-auto flex max-w-[540px] flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <div class="flex size-10 items-center justify-center rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-icon-icon-muted">
        <Icon name="clock" />
      </div>
      <div class="flex flex-col gap-1.5">
        <h2 class="text-[15px] leading-5 font-medium text-v2-text-text-base">
          {props.loading ? "Loading automations…" : "No automations yet"}
        </h2>
        <p class="text-[13px] leading-5 text-v2-text-text-muted">
          Schedule prompts on a timer or cron, or poll a shell command or Code Mode script with zero model tokens until
          something changes.
        </p>
      </div>
      <Show when={!props.loading}>
        <div class="flex w-full flex-col gap-1.5 text-start">
          <For each={STARTER_RECIPES}>
            {(recipe) => (
              <button
                type="button"
                onClick={() => props.onPick(recipe.prompt)}
                class="group flex items-center justify-between gap-3 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 text-start transition-colors hover:border-v2-border-border-strong hover:bg-v2-background-bg-layer-02"
              >
                <div class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-[13px] leading-4 font-medium text-v2-text-text-base">{recipe.label}</span>
                  <span class="truncate font-mono text-[11px] leading-4 text-v2-text-text-faint">{recipe.prompt}</span>
                </div>
                <Icon
                  name="arrow-right"
                  size="small"
                  class="shrink-0 text-v2-icon-icon-muted transition-transform group-hover:translate-x-0.5"
                />
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
