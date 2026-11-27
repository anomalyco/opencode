import { Button } from "@opencode/ui/button"
import { Predicate } from "effect"
import { createMemo, For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { formatDate, relativeTime, statusLabel } from "./format"
import type { AutomationItem } from "./model"

export function AutomationListRow(props: {
  entry: AutomationItem
  selected: boolean
  context: string[]
  onSelect: () => void
}) {
  const language = useLanguage()
  const row = () => props.entry.row

  const note = () => {
    if (row().status === "paused" && row().lastOutcome === "failed") return language.t("automations.note.failed")

    if (row().status === "done" && row().lastOutcome === "expired") return language.t("automations.status.expired")

    const next = row().status === "active" ? row().nextDueAt : undefined

    if (next) return relativeTime(next, language)
  }

  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
      class="flex w-full flex-col gap-0.5 rounded-[7px] px-2.5 py-2 text-start hover:bg-v2-overlay-simple-overlay-hover aria-pressed:bg-v2-background-bg-layer-02"
    >
      <span class="flex w-full min-w-0 items-baseline gap-3">
        <bdi class="min-w-0 flex-1 truncate text-[13px] leading-5 font-medium text-v2-text-text-base">{row().name}</bdi>
        <Show when={note()}>
          {(text) => <span class="shrink-0 text-[12px] leading-5 text-v2-text-text-muted">{text()}</span>}
        </Show>
      </span>
      <span class="w-full truncate text-[12px] leading-4 text-v2-text-text-faint">
        <Parts items={[...props.context, props.entry.trigger]} />
      </span>
    </button>
  )
}

export function AutomationInspector(props: {
  entry: AutomationItem
  busy: boolean
  context: string[]
  onTogglePause: () => void
  onOpenSession: (id: string) => void
  onDelete: () => void
}) {
  const language = useLanguage()
  const t = language.t
  const row = () => props.entry.row

  const event = createMemo(() => {
    const trigger = row().trigger

    return trigger.type === "event" ? trigger : undefined
  })

  // Flat filters read as `environment = "staging"`; anything nested keeps its JSON.
  const args = createMemo(() => {
    const value = event()?.args

    if (!value) return

    const entries = Object.entries(value)

    if (entries.some(([, item]) => Predicate.isObject(item))) return { block: JSON.stringify(value, null, 2) }

    return { inline: entries.map(([key, item]) => `${key} = ${JSON.stringify(item)}`).join(", ") }
  })

  const next = () => (row().status === "active" ? row().nextDueAt : undefined)

  // Takes accessors: `Show` keeps its children when the selection moves to another automation.
  const link = (id: () => string, name: () => string) => (
    <button
      type="button"
      onClick={() => props.onOpenSession(id())}
      class="inline max-w-full text-start font-medium text-v2-text-text-base underline decoration-v2-border-border-strong underline-offset-[3px] hover:decoration-current"
    >
      <bdi>{name()}</bdi>
    </button>
  )

  const action = () => {
    const value = row().action

    switch (value.type) {
      case "prompt": {
        const session = value.to.session

        return {
          summary: session
            ? language.rich("automations.do.prompt", {
                session: link(
                  () => session,
                  () => props.entry.recipient ?? session,
                ),
              })
            : t("automations.do.subagent", { agent: value.to.subagent ?? "" }),
          body: value.prompt,
        }
      }

      case "code":
        return {
          summary: t("automations.do.code"),
          hint: t("automations.do.codeHint"),
          body: value.code,
          code: true,
          args: value.args === undefined ? undefined : JSON.stringify(value.args, null, 2),
        }
      case "shell":
        return {
          summary: t("automations.do.shell"),
          hint: t("automations.do.shellHint"),
          body: value.command,
          code: true,
        }
    }
  }

  const time = (at: () => number) => (
    <time title={formatDate(at(), row().tz, language)}>{relativeTime(at(), language)}</time>
  )

  return (
    <article class="mx-auto flex w-full max-w-[720px] flex-col gap-7 px-6 py-6 lg:px-8">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 dir="auto" class="text-[16px] leading-6 font-semibold text-v2-text-text-base">
            {row().name}
          </h2>
          <p class="text-[13px] leading-5 text-v2-text-text-muted">
            <Parts items={[statusLabel(row(), t), ...props.context]} />
          </p>
        </div>
        <div class="flex items-center gap-1">
          <Show when={row().status !== "done"}>
            <Button type="button" variant="neutral" size="small" disabled={props.busy} onClick={props.onTogglePause}>
              {t(row().status === "paused" ? "automations.action.resume" : "automations.action.pause")}
            </Button>
          </Show>
          <Button type="button" variant="ghost-muted" size="small" disabled={props.busy} onClick={props.onDelete}>
            {t("automations.delete.button")}
          </Button>
        </div>
      </header>

      <dl class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-5 text-[13px] leading-5">
        <Row label={t("automations.when")}>
          <div class="text-v2-text-text-base">
            <bdi>{props.entry.trigger}</bdi>
          </div>
          <Show when={!event()}>
            <div class="text-v2-text-text-muted">
              <bdi>{row().tz}</bdi>
              <Show when={next()}>{(at) => <> · {language.rich("automations.nextRun", { time: time(at) })}</>}</Show>
            </div>
          </Show>
          <Show when={args()?.inline}>
            {(text) => (
              <bdi dir="ltr" class="block font-mono text-[12px] text-v2-text-text-muted">
                {text()}
              </bdi>
            )}
          </Show>
          <Show when={args()?.block}>{(text) => <Content code>{text()}</Content>}</Show>
        </Row>

        <Row label={t("automations.do")}>
          <div class="text-v2-text-text-base">{action().summary}</div>
          <Show when={action().hint}>{(hint) => <div class="text-v2-text-text-muted">{hint()}</div>}</Show>
          <Content code={action().code}>{action().body}</Content>
          <Show when={action().args}>{(text) => <Content code>{text()}</Content>}</Show>
        </Row>

        <Row label={t("automations.lastRun")}>
          <div class="text-v2-text-text-base">
            <Show when={row().lastRunAt} fallback={t("automations.neverRun")}>
              {(at) => (
                <>
                  {time(at)}
                  <span class="text-v2-text-text-muted">
                    {" "}
                    · {language.plural("automations.runCount", row().runCount)}
                  </span>
                </>
              )}
            </Show>
          </div>
          <Show when={row().lastOutput}>{(output) => <Content code>{output()}</Content>}</Show>
        </Row>
      </dl>

      <dl class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-v2-border-border-base pt-5 text-[12px] leading-5">
        <Row label={t("automations.folder")} muted>
          <bdi dir="ltr" class="break-all font-mono">
            {row().directory}
          </bdi>
        </Row>
        <Show when={row().sessionID}>
          {(id) => (
            <Row label={t("automations.creator")} muted>
              {link(id, () => props.entry.creator ?? id())}
            </Row>
          )}
        </Show>
        <Row label={t("automations.runsOn")} muted>
          <bdi>{props.entry.serverLabel}</bdi>
        </Row>
      </dl>
    </article>
  )
}

function Parts(props: { items: string[] }) {
  return (
    <For each={props.items}>
      {(item, index) => (
        <>
          <Show when={index() > 0}> · </Show>
          <bdi>{item}</bdi>
        </>
      )}
    </For>
  )
}

function Row(props: { label: string; muted?: boolean; children: JSX.Element }) {
  return (
    <>
      <dt class="text-v2-text-text-faint">{props.label}</dt>
      <dd class="flex min-w-0 flex-col gap-1.5 break-words" classList={{ "text-v2-text-text-muted": props.muted }}>
        {props.children}
      </dd>
    </>
  )
}

function Content(props: { code?: boolean; children: JSX.Element }) {
  return (
    <div
      data-scrollable
      dir={props.code ? "ltr" : "auto"}
      class="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-v2-background-bg-layer-01 px-3 py-2.5 text-[13px] leading-5 text-v2-text-text-base select-text"
      classList={{ "font-mono text-[12px]": props.code }}
    >
      {props.children}
    </div>
  )
}
