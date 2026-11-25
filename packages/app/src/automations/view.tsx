import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { statusLabel } from "./format"
import type { AutomationItem } from "./model"

function StatusDot(props: { item: AutomationItem }) {
  return (
    <span
      aria-hidden="true"
      class="size-2 shrink-0 rounded-full border"
      classList={{
        "border-transparent bg-v2-state-fg-success": props.item.row.status === "active",
        "border-v2-border-border-strong": props.item.row.status === "paused",
        "border-transparent bg-v2-text-text-faint": props.item.row.status === "done",
      }}
    />
  )
}

export function AutomationListRow(props: {
  entry: AutomationItem
  selected: boolean
  multiServer: boolean
  onSelect: () => void
}) {
  const language = useLanguage()

  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
      class="flex w-full flex-col gap-1 rounded-[7px] px-2.5 py-2 text-start hover:bg-v2-overlay-simple-overlay-hover aria-pressed:bg-v2-background-bg-layer-02"
    >
      <span class="flex w-full min-w-0 items-center gap-2">
        <StatusDot item={props.entry} />
        <bdi class="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium text-v2-text-text-base">
          {props.entry.row.name}
        </bdi>
        <span class="text-[11px] leading-4 text-v2-text-text-muted">{statusLabel(props.entry.row, language.t)}</span>
      </span>
      <span class="flex w-full min-w-0 items-center gap-1.5 ps-4 text-[12px] leading-4 text-v2-text-text-faint">
        <span class="flex size-3.5 shrink-0 items-center justify-center">
          <SessionTabAvatarView project={props.entry.project} directory={props.entry.row.directory} unread={false} />
        </span>
        <span class="shrink-0 rounded bg-v2-background-bg-layer-01 px-1 text-[10px] font-medium uppercase tracking-wide">
          {language.t(
            props.entry.row.trigger.type === "event" ? "automations.kind.event" : "automations.kind.schedule",
          )}
        </span>
        <span class="truncate">
          <Show when={props.multiServer}>
            <bdi>{props.entry.serverLabel}</bdi> ·{" "}
          </Show>
          <bdi>{props.entry.projectName}</bdi> · <bdi>{props.entry.trigger}</bdi>
        </span>
      </span>
    </button>
  )
}

function Fact(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <dt class="text-[12px] leading-4 text-v2-text-text-faint">{props.label}</dt>
      <dd class="min-w-0 break-words text-[13px] leading-5 text-v2-text-text-base">{props.children}</dd>
    </div>
  )
}

function Block(props: { label: string; children: JSX.Element; code?: boolean }) {
  return (
    <section class="flex flex-col gap-1.5">
      <h3 class="text-[12px] leading-4 font-medium text-v2-text-text-muted">{props.label}</h3>
      <div
        data-scrollable
        dir={props.code ? "ltr" : "auto"}
        class="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3 text-[13px] leading-5 text-v2-text-text-base select-text"
        classList={{ "font-mono": props.code }}
      >
        {props.children}
      </div>
    </section>
  )
}

export function AutomationInspector(props: {
  entry: AutomationItem
  busy: boolean
  onTogglePause: () => void
  onOpenSession: (id: string) => void
  onDelete: () => void
}) {
  const language = useLanguage()
  const t = language.t
  const row = () => props.entry.row
  const action = createMemo(() => props.entry.row.action)

  const event = createMemo(() => {
    const trigger = row().trigger

    return trigger.type === "event" ? trigger : undefined
  })

  const prompt = createMemo(() => {
    const a = action()

    return a.type === "prompt" ? a : undefined
  })

  const code = createMemo(() => {
    const a = action()

    return a.type === "code" ? a : undefined
  })

  const shell = createMemo(() => {
    const a = action()

    return a.type === "shell" ? a : undefined
  })

  const date = (at: number) =>
    new Date(at).toLocaleString(language.intl(), { dateStyle: "medium", timeStyle: "short", timeZone: row().tz })

  const link = (id: string, name: string) => (
    <button
      type="button"
      onClick={() => props.onOpenSession(id)}
      class="inline-flex max-w-full items-center gap-1 text-start hover:underline"
    >
      <bdi>{name}</bdi>
      <Icon name="arrow-up-right" size="small" />
    </button>
  )

  return (
    <article class="mx-auto flex w-full max-w-[760px] flex-col gap-5 p-5 lg:p-6">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex items-center gap-2 text-[12px] leading-4 text-v2-text-text-muted">
            <StatusDot item={props.entry} />
            {statusLabel(row(), t)} · <bdi>{props.entry.projectName}</bdi>
          </div>
          <h2 dir="auto" class="text-[16px] leading-6 font-semibold text-v2-text-text-base">
            {row().name}
          </h2>
          <bdi dir="ltr" class="break-all font-mono text-[12px] leading-4 text-v2-text-text-faint">
            {row().directory}
          </bdi>
        </div>
        <div class="flex items-center gap-1.5">
          <Show when={row().status !== "done"}>
            <Button type="button" variant="neutral" size="small" disabled={props.busy} onClick={props.onTogglePause}>
              {t(row().status === "paused" ? "automations.action.resume" : "automations.action.pause")}
            </Button>
          </Show>
          <Tooltip placement="bottom" value={t("automations.delete.title")}>
            <IconButton
              type="button"
              variant="ghost-muted"
              size="normal"
              disabled={props.busy}
              aria-label={t("automations.delete.title")}
              icon={<Icon name="trash" size="small" />}
              onClick={props.onDelete}
            />
          </Tooltip>
        </div>
      </header>
      <dl class="flex flex-wrap gap-x-8 gap-y-3 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3">
        <Fact label={t("automations.runsOn")}>
          <bdi>{props.entry.serverLabel}</bdi>
        </Fact>
        <Fact label={t(event() ? "automations.kind.event" : "automations.section.trigger")}>
          <bdi>{props.entry.trigger}</bdi>
          <Show when={!event()}>
            <div class="text-[12px] text-v2-text-text-faint">
              <bdi>{row().tz}</bdi>
            </div>
          </Show>
        </Fact>
        <Show when={event()}>
          {(trigger) => (
            <Fact label={t("automations.eventSource")}>
              <bdi>{trigger().server}</bdi>
            </Fact>
          )}
        </Show>
        <Show when={!event() && row().status === "active" ? row().nextDueAt : undefined}>
          {(at) => <Fact label={t("automations.section.nextRun")}>{date(at())}</Fact>}
        </Show>
        <Fact label={t("automations.section.runs")}>{row().runCount}</Fact>
        <Show when={row().lastRunAt}>{(at) => <Fact label={t("automations.section.lastRun")}>{date(at())}</Fact>}</Show>
      </dl>
      <dl class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Show when={row().sessionID}>
          {(id) => <Fact label={t("automations.creator")}>{link(id(), props.entry.creator ?? id())}</Fact>}
        </Show>
        <Fact label={t("automations.recipient")}>
          <Show when={prompt()} fallback={t(shell() ? "automations.noRecipient" : "automations.conditional")}>
            {(action) => (
              <Show when={action().to.session} fallback={t("automations.child", { agent: action().to.subagent ?? "" })}>
                {(id) => link(id(), props.entry.recipient ?? id())}
              </Show>
            )}
          </Show>
        </Fact>
      </dl>
      <Show when={event()?.args}>
        {(args) => (
          <Block label={t("automations.eventArgs")} code>
            {JSON.stringify(args(), null, 2)}
          </Block>
        )}
      </Show>
      <Show when={prompt()}>{(a) => <Block label={t("automations.section.prompt")}>{a().prompt}</Block>}</Show>
      <Show when={code()}>
        {(a) => (
          <>
            <Block label={t("automations.section.code")} code>
              {a().code}
            </Block>
            <Show when={a().args !== undefined}>
              <Block label={t("automations.codeArgs")} code>
                {JSON.stringify(a().args, null, 2)}
              </Block>
            </Show>
          </>
        )}
      </Show>
      <Show when={shell()}>
        {(a) => (
          <Block label={t("automations.section.shell")} code>
            {a().command}
          </Block>
        )}
      </Show>
      <Show when={row().lastOutput}>
        {(output) => (
          <Block label={t("automations.section.output")} code>
            {output()}
          </Block>
        )}
      </Show>
    </article>
  )
}
