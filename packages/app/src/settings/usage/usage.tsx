import { Button } from "@opencode/ui/button"
import { Loader } from "@opencode/ui/loader"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, createResource, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { UsageDialogContent } from "@/usage/dialog"
import { useUsageFormat } from "@/usage/format"
import { TokenUsage } from "@opencode/schema/token-usage"
import "./usage.css"

export function SettingsUsage(props: { active: boolean; headerAction?: JSX.Element }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const dialog = useDialog()
  const format = useUsageFormat()
  const [state, setState] = createStore({ days: 7, sessions: 10 })
  const [stats, actions] = createResource(
    () => props.active && state.days,
    async (days) => {
      const to = Date.now()
      const from = new Date(to)
      from.setHours(0, 0, 0, 0)
      from.setDate(from.getDate() - days + 1)
      const result = await sdk.api.experimental.session.stats({
        from: from.getTime(),
        to,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        tools: "detail",
      })
      return { days, value: result }
    },
  )
  const [limits, limitActions] = createResource(
    () => props.active,
    async () => (await sdk.api.experimental.usage.limits()).data,
  )
  // A settings read must not suspend the whole route or display the previous period as the new one.
  const info = () =>
    (stats.state === "ready" || stats.state === "refreshing") && stats.latest?.days === state.days
      ? stats.latest.value
      : undefined
  const allowance = () => (limits.state === "ready" || limits.state === "refreshing" ? limits.latest : undefined)
  const number = (value: number) => new Intl.NumberFormat(language.intl()).format(value)
  const toolUsage = () => {
    const tools = info()?.tools
    return tools?.mode === "detail" ? tools.usage : []
  }
  const toolCalls = () => {
    const tools = info()?.tools
    return tools && tools.mode !== "none" ? tools.totals.calls : 0
  }
  const skillCalls = () => toolUsage().find((tool) => tool.name === "skill")?.calls ?? 0
  const activity = createMemo(() => {
    const end = new Date(info()?.range.to ?? Date.now())
    end.setHours(0, 0, 0, 0)
    return Array.from({ length: state.days }, (_, index) => {
      const day = new Date(end)
      day.setDate(day.getDate() - state.days + index + 1)
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
      return {
        label: new Intl.DateTimeFormat(language.intl(), { month: "short", day: "numeric" }).format(day),
        steps: info()?.activity.find((row) => row.date === key)?.steps ?? 0,
      }
    })
  })
  const maximum = () => Math.max(1, ...activity().map((day) => day.steps))
  const refresh = () => {
    void actions.refetch()
    void limitActions.refetch()
  }

  function Section(section: { title: string; children: JSX.Element; note?: string }) {
    return (
      <section class="settings-section usage-section" aria-label={section.title}>
        <h3 class="settings-section-title">{section.title}</h3>
        <Show when={section.note}>
          <p class="usage-note">{section.note}</p>
        </Show>
        {section.children}
      </section>
    )
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.usage.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.usage.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned settings-usage">
        <div class="usage-controls">
          <div role="group" aria-label={language.t("settings.usage.title")}>
            <For each={[7, 30]}>
              {(days) => (
                <Button
                  variant={state.days === days ? "neutral" : "ghost"}
                  aria-pressed={state.days === days}
                  onClick={() => setState({ days, sessions: 10 })}
                >
                  {language.t(days === 7 ? "settings.usage.sevenDays" : "settings.usage.thirtyDays")}
                </Button>
              )}
            </For>
          </div>
          <Button variant="ghost" disabled={stats.loading || limits.loading} onClick={refresh}>
            {language.t("settings.usage.refresh")}
          </Button>
        </div>
        <Section title={language.t("settings.usage.limits")} note={language.t("settings.usage.limitsNote")}>
          <Show when={limits.loading}>
            <Loader />
          </Show>
          <Show when={limits.error}>
            <p class="usage-note" role="alert">
              {language.t("settings.usage.limitError")}
            </p>
          </Show>
          <Show when={!limits.loading && !limits.error && !allowance()}>
            <p class="usage-note">{language.t("settings.usage.limitsUnavailable")}</p>
          </Show>
          <Show when={allowance()}>
            {(value) => (
              <div class="usage-card">
                <strong>
                  <bdi>{value().workspace.name ?? value().workspace.id}</bdi>
                </strong>
                <Show when={value().go}>
                  {(go) => (
                    <For each={["rolling", "weekly", "monthly"] as const}>
                      {(window) => (
                        <div class="usage-meter">
                          <div>
                            <span>{language.t(`usage.go.${window}`)}</span>
                            <span>{language.t("usage.go.used", { percent: Math.round(go()[window].percent) })}</span>
                          </div>
                          <div
                            class="usage-meter-track"
                            role="meter"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={go()[window].percent}
                            aria-label={language.t(`usage.go.${window}`)}
                          >
                            <span style={{ width: `${go()[window].percent}%` }} />
                          </div>
                          <span class="usage-note">
                            {language.t("settings.usage.resets", { time: format.time(go()[window].resetsAt) })}
                          </span>
                        </div>
                      )}
                    </For>
                  )}
                </Show>
                <Button variant="ghost" onClick={() => dialog.show(() => <UsageDialogContent info={value()} />)}>
                  {language.t("settings.usage.limitDetails")}
                </Button>
              </div>
            )}
          </Show>
        </Section>
        <Show when={stats.loading}>
          <div role="status">
            <Loader />
          </div>
        </Show>
        <Show when={stats.error}>
          <div role="alert" class="usage-controls">
            <span>{language.t("settings.usage.error")}</span>
            <Button onClick={() => void actions.refetch()}>{language.t("usage.retry")}</Button>
          </div>
        </Show>
        <Show when={info()}>
          {(value) => (
            <>
              <div class="usage-summary">
                <For
                  each={[
                    [language.t("settings.usage.steps"), number(value().steps)],
                    [language.t("settings.usage.sessions"), number(value().sessions + value().subagents)],
                    [language.t("settings.usage.tokens"), number(TokenUsage.total(value().tokens))],
                    [language.t("settings.usage.cost"), format.money(value().cost)],
                    [language.t("settings.usage.tools"), number(toolCalls())],
                    [language.t("settings.usage.skills"), number(skillCalls())],
                  ]}
                >
                  {([label, count]) => (
                    <div class="usage-card">
                      <span class="usage-note">{label}</span>
                      <strong class="usage-total">{count}</strong>
                    </div>
                  )}
                </For>
              </div>
              <p class="usage-note">{language.t("settings.usage.note")}</p>
              <Section title={language.t("settings.usage.activity")}>
                <div class="usage-card">
                  <div class="usage-chart" role="img" aria-label={language.t("settings.usage.activity")} dir="ltr">
                    <For each={activity()}>
                      {(day) => (
                        <div class="usage-day" title={`${day.label}: ${number(day.steps)}`}>
                          <div class="usage-bar" style={{ height: `${(day.steps / maximum()) * 100}%` }} />
                        </div>
                      )}
                    </For>
                  </div>
                  <div class="usage-controls" dir="ltr">
                    <span>{activity()[0]?.label}</span>
                    <span>{activity().at(-1)?.label}</span>
                  </div>
                  <details>
                    <summary>{language.t("settings.usage.activity")}</summary>
                    <dl class="usage-days">
                      <For each={activity()}>
                        {(day) => (
                          <div>
                            <dt>{day.label}</dt>
                            <dd>{number(day.steps)}</dd>
                          </div>
                        )}
                      </For>
                    </dl>
                  </details>
                </div>
              </Section>
              <Section title={language.t("settings.usage.models")}>
                <div class="usage-table-wrap" data-scrollable>
                  <table class="usage-table" aria-label={language.t("settings.usage.models")}>
                    <thead>
                      <tr>
                        <For
                          each={
                            [
                              "name",
                              "steps",
                              "input",
                              "output",
                              "reasoning",
                              "cacheRead",
                              "cacheWrite",
                              "cost",
                            ] as const
                          }
                        >
                          {(key) => <th>{language.t(`settings.usage.${key}`)}</th>}
                        </For>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={value().models}>
                        {(row) => (
                          <tr>
                            <th>
                              <bdi>
                                {row.model.id}
                                {row.model.variant ? ` #${row.model.variant}` : ""}
                              </bdi>
                              <small>
                                <bdi>{row.model.providerID}</bdi>
                              </small>
                            </th>
                            <For
                              each={[
                                row.steps,
                                row.tokens.input,
                                row.tokens.output,
                                row.tokens.reasoning,
                                row.tokens.cache.read,
                                row.tokens.cache.write,
                              ]}
                            >
                              {(count) => <td>{number(count)}</td>}
                            </For>
                            <td>{format.money(row.cost)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <Show when={!value().models.length}>
                  <p class="usage-note">{language.t("settings.usage.empty")}</p>
                </Show>
              </Section>
              <Section title={language.t("settings.usage.sessionBreakdown")}>
                <div class="usage-table-wrap" data-scrollable>
                  <table class="usage-table" aria-label={language.t("settings.usage.sessionBreakdown")}>
                    <thead>
                      <tr>
                        <For each={["name", "steps", "tokens", "cost"] as const}>
                          {(key) => <th>{language.t(`settings.usage.${key}`)}</th>}
                        </For>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={value().sessionUsage?.slice(0, state.sessions)}>
                        {(row) => (
                          <tr>
                            <th>
                              <bdi>{row.title || row.sessionID}</bdi>
                              <Show when={row.parentID}>
                                <small>{language.t("settings.usage.child")}</small>
                              </Show>
                            </th>
                            <td>{number(row.steps)}</td>
                            <td>{number(TokenUsage.total(row.tokens))}</td>
                            <td>{format.money(row.cost)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <Show when={!value().sessionUsage?.length}>
                  <p class="usage-note">
                    {language.t(value().sessionUsage ? "settings.usage.empty" : "settings.usage.detailUnavailable")}
                  </p>
                </Show>
                <Show when={(value().sessionUsage?.length ?? 0) > state.sessions}>
                  <Button variant="ghost" onClick={() => setState("sessions", (count) => count + 10)}>
                    {language.t("settings.usage.more")}
                  </Button>
                </Show>
              </Section>
              <Section
                title={language.t("settings.usage.skillBreakdown")}
                note={language.t("settings.usage.skillNote")}
              >
                <div class="usage-table-wrap" data-scrollable>
                  <table class="usage-table" aria-label={language.t("settings.usage.skillBreakdown")}>
                    <thead>
                      <tr>
                        <th>{language.t("settings.usage.name")}</th>
                        <th>{language.t("settings.usage.calls")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={value().skills}>
                        {(row) => (
                          <tr>
                            <th>
                              <bdi>{row.id}</bdi>
                            </th>
                            <td>{number(row.calls)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <Show when={!value().skills?.length}>
                  <p class="usage-note">
                    {language.t(value().skills ? "settings.usage.empty" : "settings.usage.detailUnavailable")}
                  </p>
                </Show>
              </Section>
              <Section title={language.t("settings.usage.toolBreakdown")}>
                <div class="usage-table-wrap" data-scrollable>
                  <table class="usage-table" aria-label={language.t("settings.usage.toolBreakdown")}>
                    <thead>
                      <tr>
                        <For each={["name", "calls", "failed", "unfinished"] as const}>
                          {(key) => <th>{language.t(`settings.usage.${key}`)}</th>}
                        </For>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={toolUsage()}>
                        {(row) => (
                          <tr>
                            <th>
                              <bdi>{row.name}</bdi>
                            </th>
                            <td>{number(row.calls)}</td>
                            <td>{number(row.failed)}</td>
                            <td>{number(row.unfinished)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <Show when={!toolUsage().length}>
                  <p class="usage-note">{language.t("settings.usage.empty")}</p>
                </Show>
              </Section>
            </>
          )}
        </Show>
      </div>
    </>
  )
}
