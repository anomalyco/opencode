/**
 * Monitor / Alerts tab.
 *
 * Two columns: rules on the left (with a create-rule form), fired event
 * feed on the right. The form adapts to the chosen condition type —
 * only the relevant inputs are rendered.
 *
 *   event-pattern    | event type + optional tool name + min count + window
 *   inactivity       | inactivity threshold (sec)
 *   stuck-agent      | states list + threshold
 *   token-threshold  | token field + limit
 */

import { createResource, createSignal, For, Show, batch } from "solid-js"
import { useLanguage } from "@/context/language"
import { createMonitorClient } from "@/utils/monitor-sdk"
import type { AlertRule } from "@/utils/monitor-schema"

function fmtTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function RuleRow(props: {
  rule: AlertRule
  language: ReturnType<typeof useLanguage>
  onDelete: (id: string) => Promise<void>
}) {
  return (
    <article class="rounded border border-border-weak-base bg-surface-base p-2 flex items-center justify-between text-12-regular">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-text-strong truncate">{props.rule.name}</span>
        <span class="text-11-regular text-text-weak font-mono">{props.rule.type}</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span
          classList={{
            "size-2 rounded-full": true,
            "bg-status-working-base": props.rule.enabled,
            "bg-border-weak-base": !props.rule.enabled,
          }}
        />
        <button
          type="button"
          onClick={async () => {
            if (!confirm(`Delete ${props.rule.name}?`)) return
            await props.onDelete(props.rule.id)
          }}
          class="px-1.5 py-0.5 text-10-medium rounded text-status-error-base"
        >
          ×
        </button>
      </div>
    </article>
  )
}

function EventRow(props: { event: AlertRule; language: ReturnType<typeof useLanguage> }) {
  // Shape adapter: AlertEvent vs AlertRule are distinct types in the SDK;
  // we accept a structural row here to keep the row component small.
  const e = props.event as unknown as {
    id: string
    rule_id: string
    session_id: string | null
    status: "fired" | "acked" | "resolved"
    time_created: number
  }
  return (
    <article class="rounded border border-border-weak-base bg-surface-base p-2 text-12-regular flex items-center justify-between gap-3">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-text-base truncate">rule {e.rule_id.slice(0, 8)}</span>
        <Show when={e.session_id}>
          <span class="text-11-regular text-text-weak truncate">session {e.session_id}</span>
        </Show>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-11-regular text-text-weak">{fmtTime(e.time_created)}</span>
        <span
          classList={{
            "size-2 rounded-full": true,
            "bg-status-error-base": e.status === "fired",
            "bg-status-completed-base": e.status === "acked",
            "bg-border-weak-base": e.status === "resolved",
          }}
        />
      </div>
    </article>
  )
}

type ConditionType = "event-pattern" | "inactivity" | "stuck-agent" | "token-threshold"

function CreateRuleForm(props: {
  onSubmit: (input: Omit<AlertRule, "id" | "time_created" | "time_updated">) => Promise<void>
  language: ReturnType<typeof useLanguage>
}) {
  const [name, setName] = createSignal("")
  const [type, setType] = createSignal<ConditionType>("event-pattern")
  const [enabled, setEnabled] = createSignal(true)
  const [cooldown, setCooldown] = createSignal(300)
  const [eventType, setEventType] = createSignal("")
  const [toolName, setToolName] = createSignal("")
  const [minCount, setMinCount] = createSignal(1)
  const [window, setWindow] = createSignal(60)
  const [inactivitySec, setInactivitySec] = createSignal(300)
  const [stuckStates, setStuckStates] = createSignal<("working" | "waiting")[]>(["working", "waiting"])
  const [stuckThreshold, setStuckThreshold] = createSignal(600)
  const [tokenField, setTokenField] = createSignal<"input" | "output" | "cache.read" | "cache.write" | "total">(
    "total",
  )
  const [tokenLimit, setTokenLimit] = createSignal(100_000)
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  function buildCondition() {
    switch (type()) {
      case "event-pattern":
        return {
          type: "event-pattern" as const,
          event_type: eventType() || undefined,
          tool_name: toolName() || undefined,
          min_count: minCount(),
          window_sec: window(),
        }
      case "inactivity":
        return { type: "inactivity" as const, threshold_sec: inactivitySec() }
      case "stuck-agent":
        return { type: "stuck-agent" as const, states: stuckStates(), threshold_sec: stuckThreshold() }
      case "token-threshold":
        return { type: "token-threshold" as const, field: tokenField(), limit: tokenLimit() }
    }
  }

  async function submit(e: Event) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await props.onSubmit({
        project_id: "default",
        name: name(),
        type: type(),
        condition: buildCondition() as never,
        cooldown_sec: cooldown(),
        enabled: enabled(),
      })
      batch(() => {
        setName("")
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      class="rounded-lg border border-border-weak-base bg-surface-base p-3 flex flex-col gap-3 text-12-regular"
    >
      <header class="flex items-center justify-between">
        <h3 class="text-13-medium text-text-base">{props.language.t("monitor.alerts.create")}</h3>
      </header>

      <div class="grid gap-2" style={{ "grid-template-columns": "2fr 1fr" }}>
        <label class="flex flex-col gap-1">
          <span class="text-11-regular text-text-weak">{props.language.t("monitor.alerts.fields.name")}</span>
          <input
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            required
            class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-11-regular text-text-weak">type</span>
          <select
            value={type()}
            onChange={(e) => setType(e.currentTarget.value as ConditionType)}
            class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
          >
            <option value="event-pattern">event-pattern</option>
            <option value="inactivity">inactivity</option>
            <option value="stuck-agent">stuck-agent</option>
            <option value="token-threshold">token-threshold</option>
          </select>
        </label>
      </div>

      <Show when={type() === "event-pattern"}>
        <div class="grid gap-2" style={{ "grid-template-columns": "1fr 1fr" }}>
          <label class="flex flex-col gap-1">
            <span class="text-11-regular text-text-weak">event type</span>
            <input
              value={eventType()}
              onInput={(e) => setEventType(e.currentTarget.value)}
              placeholder="e.g. message.updated"
              class="px-2 py-1 rounded border border-border-weak-base bg-surface-base font-mono"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-11-regular text-text-weak">tool name</span>
            <input
              value={toolName()}
              onInput={(e) => setToolName(e.currentTarget.value)}
              placeholder="e.g. read"
              class="px-2 py-1 rounded border border-border-weak-base bg-surface-base font-mono"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-11-regular text-text-weak">min count</span>
            <input
              type="number"
              min="1"
              value={minCount()}
              onInput={(e) => setMinCount(parseInt(e.currentTarget.value) || 1)}
              class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-11-regular text-text-weak">window (s)</span>
            <input
              type="number"
              min="1"
              value={window()}
              onInput={(e) => setWindow(parseInt(e.currentTarget.value) || 60)}
              class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
            />
          </label>
        </div>
      </Show>

      <Show when={type() === "inactivity"}>
        <label class="flex flex-col gap-1">
          <span class="text-11-regular text-text-weak">inactivity threshold (s)</span>
          <input
            type="number"
            min="60"
            value={inactivitySec()}
            onInput={(e) => setInactivitySec(parseInt(e.currentTarget.value) || 60)}
            class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
          />
        </label>
      </Show>

      <Show when={type() === "stuck-agent"}>
        <div class="grid gap-2" style={{ "grid-template-columns": "1fr 1fr" }}>
          <label class="flex flex-col gap-1">
            <span class="text-11-regular text-text-weak">states</span>
            <div class="flex gap-2 items-center">
              <label class="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={stuckStates().includes("working")}
                  onChange={(e) =>
                    setStuckStates((prev) =>
                      e.currentTarget.checked ? [...prev, "working"] : prev.filter((s) => s !== "working"),
                    )
                  }
                />
                working
              </label>
              <label class="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={stuckStates().includes("waiting")}
                  onChange={(e) =>
                    setStuckStates((prev) =>
                      e.currentTarget.checked ? [...prev, "waiting"] : prev.filter((s) => s !== "waiting"),
                    )
                  }
                />
                waiting
              </label>
            </div>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-11-regular text-text-weak">threshold (s)</span>
            <input
              type="number"
              min="60"
              value={stuckThreshold()}
              onInput={(e) => setStuckThreshold(parseInt(e.currentTarget.value) || 60)}
              class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
            />
          </label>
        </div>
      </Show>

      <Show when={type() === "token-threshold"}>
        <div class="grid gap-2" style={{ "grid-template-columns": "1fr 1fr" }}>
          <label class="flex flex-col gap-1">
            <span class="text-11-regular text-text-weak">field</span>
            <select
              value={tokenField()}
              onChange={(e) => setTokenField(e.currentTarget.value as never)}
              class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
            >
              <option value="total">total</option>
              <option value="input">input</option>
              <option value="output">output</option>
              <option value="cache.read">cache.read</option>
              <option value="cache.write">cache.write</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-11-regular text-text-weak">limit</span>
            <input
              type="number"
              min="1"
              value={tokenLimit()}
              onInput={(e) => setTokenLimit(parseInt(e.currentTarget.value) || 1)}
              class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
            />
          </label>
        </div>
      </Show>

      <div class="grid gap-2" style={{ "grid-template-columns": "1fr 1fr" }}>
        <label class="flex flex-col gap-1">
          <span class="text-11-regular text-text-weak">{props.language.t("monitor.alerts.fields.cooldown")}</span>
          <input
            type="number"
            min="0"
            value={cooldown()}
            onInput={(e) => setCooldown(parseInt(e.currentTarget.value) || 0)}
            class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
          />
        </label>
        <label class="flex items-center gap-2 mt-5">
          <input
            type="checkbox"
            checked={enabled()}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
          />
          <span class="text-11-regular text-text-weak">{props.language.t("monitor.alerts.fields.enabled")}</span>
        </label>
      </div>

      <Show when={error()}>
        <p class="text-11-regular text-status-error-base">{error()}</p>
      </Show>

      <button
        type="submit"
        disabled={submitting() || !name()}
        class="px-3 py-1.5 text-12-medium rounded bg-surface-strong-base text-text-base disabled:opacity-50 self-start"
      >
        {submitting() ? "…" : props.language.t("monitor.common.save")}
      </button>
    </form>
  )
}

export function MonitorAlerts(props: { baseUrl: string }) {
  const language = useLanguage()
  const client = createMonitorClient({ baseUrl: props.baseUrl })
  const [onlyUnacked, setOnlyUnacked] = createSignal(false)
  const [rules, { refetch: refetchRules }] = createResource(() => client.alertRules())
  const [events, { refetch: refetchEvents }] = createResource(() => client.alertEvents())

  const filteredEvents = () => {
    const list = (events() ?? []) as unknown as { status: string }[]
    return onlyUnacked() ? list.filter((e) => e.status === "fired") : list
  }

  async function onCreate(input: Omit<AlertRule, "id" | "time_created" | "time_updated">) {
    await client.createAlertRule(input)
    refetchRules()
  }

  async function onDelete(id: string) {
    await client.deleteAlertRule(id)
    refetchRules()
  }

  async function onAck(id: string) {
    await client.alertAck(id)
    refetchEvents()
  }

  return (
    <div class="flex flex-col gap-4">
      <header class="flex items-center justify-between">
        <h2 class="text-14-medium text-text-base">{language.t("monitor.alerts.title")}</h2>
        <div class="flex items-center gap-2">
          <label class="text-12-regular text-text-weak flex items-center gap-1">
            <input
              type="checkbox"
              checked={onlyUnacked()}
              onChange={(e) => setOnlyUnacked(e.currentTarget.checked)}
            />
            {language.t("monitor.alerts.only_unacked")}
          </label>
        </div>
      </header>

      <div class="grid gap-4" style={{ "grid-template-columns": "1fr 1.5fr" }}>
        <section class="flex flex-col gap-3">
          <CreateRuleForm onSubmit={onCreate} language={language} />
          <div class="flex flex-col gap-2">
            <header class="flex items-center justify-between">
              <span class="text-12-medium text-text-weak uppercase tracking-wide">rules</span>
              <span class="text-11-regular text-text-weak">({rules()?.length ?? 0})</span>
            </header>
            <Show
              when={rules() && rules()!.length}
              fallback={
                <p class="text-12-regular text-text-weak">{language.t("monitor.common.empty")}</p>
              }
            >
              <div class="flex flex-col gap-2">
                <For each={rules()}>
                  {(r) => <RuleRow rule={r} language={language} onDelete={onDelete} />}
                </For>
              </div>
            </Show>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <header class="flex items-center justify-between">
            <span class="text-12-medium text-text-weak uppercase tracking-wide">
              {language.t("monitor.alerts.activity")}
            </span>
            <span class="text-11-regular text-text-weak">({filteredEvents().length})</span>
          </header>
          <Show
            when={filteredEvents().length}
            fallback={
              <p class="text-12-regular text-text-weak">{language.t("monitor.common.empty")}</p>
            }
          >
            <div class="flex flex-col gap-2 max-h-[480px] overflow-y-auto">
              <For each={filteredEvents() as unknown as AlertRule[]}>
                {(e) => (
                  <div class="flex items-center gap-2">
                    <div class="flex-1">
                      <EventRow event={e} language={language} />
                    </div>
                    <button
                      type="button"
                      onClick={() => onAck((e as unknown as { id: string }).id)}
                      class="px-2 py-0.5 text-10-medium rounded bg-surface-base text-text-base border border-border-weak-base"
                    >
                      {language.t("monitor.alerts.acked")}
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </div>
  )
}