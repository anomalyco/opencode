import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createEffect, createMemo, createResource, Show } from "solid-js"
import {
  bitcostBoundTaskID,
  bitcostPricing,
  bitcostReportStatus,
  bitcostTaskDetails,
  ensureBitcostPricing,
  rememberBitcostTasks,
} from "../../component/bitcost-binding"
import { fetchBitcostTasks } from "../../component/bitcost-api"
import { lastTurnModel, localRate, rateSummary, userTurnCount, type RateSummary } from "../../component/bitcost-rate"
import { Link } from "../../ui/link"

const id = "internal:sidebar-bitcost-task"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function formatDate(value?: string | null): string | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return undefined
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const taskID = createMemo(() => bitcostBoundTaskID(props.session_id))
  const details = createMemo(() => {
    const tid = taskID()
    return tid ? bitcostTaskDetails(tid) : undefined
  })
  const reportStatus = createMemo(() => bitcostReportStatus(props.session_id))

  // When the session's task id is known but its details aren't (e.g. after a
  // restart, before the picker was ever opened this session), fetch the task list
  // once to resolve the name and usage. Best-effort — failures leave the id shown.
  createResource(
    () => (taskID() && !details() ? taskID() : undefined),
    async () => {
      try {
        rememberBitcostTasks(await fetchBitcostTasks())
      } catch {
        // best-effort hydration
      }
    },
  )

  // bitcost-authoritative rate for the model of the latest turn (per 1M tokens).
  const model = createMemo(() => lastTurnModel(props.api.state.session.messages(props.session_id)))
  createEffect(() => {
    const m = model()
    if (m) ensureBitcostPricing(m.provider, m.model)
  })
  const rates = createMemo<RateSummary | undefined>(() => {
    const m = model()
    if (!m) return undefined
    const bc = bitcostPricing(m.provider, m.model)
    if (bc) return bc // bitcost-authoritative rate
    if (bc === null) {
      // Fetched, but bitcost has no row → fall back to the local model catalog.
      const local = props.api.state.provider.find((p) => p.id === m.provider)?.models[m.model]
      return localRate(local?.cost)
    }
    return undefined // not fetched yet
  })
  const turns = createMemo(() => {
    const remote = details()?.usage_count
    const local = userTurnCount(props.api.state.session.messages(props.session_id))
    if (remote === undefined) {
      return local > 0 ? local : undefined
    }

    return Math.max(remote, local)
  })

  return (
    <Show when={taskID()}>
      {(tid) => (
        <box>
          <text fg={theme().text}>
            <b>Task</b>
          </text>
          <text fg={theme().text}>{details()?.name ?? `#${tid()}`}</text>
          <Show when={details()}>
            {(d) => (
              <>
                <Show when={d().status}>
                  <text fg={theme().textMuted}>Status: {d().status}</text>
                </Show>
                <Show when={d().cost_total !== undefined}>
                  <text fg={theme().textMuted}>Cost: {money.format(d().cost_total ?? 0)}</text>
                </Show>
                <Show when={turns() !== undefined}>
                  <text fg={theme().textMuted}>{turns()} turns</text>
                </Show>
                <Show when={reportStatus()}>
                  <text fg={theme().textMuted}>
                    Bitcost API: {reportStatus()!.successes} ok · {reportStatus()!.failures} failed
                  </text>
                </Show>
                <Show when={rates()}>{(p) => <text fg={theme().textMuted}>Rate/1M: {rateSummary(p())}</text>}</Show>
                <Show when={formatDate(d().completed_at) ?? formatDate(d().created_at)}>
                  {(date) => (
                    <text fg={theme().textMuted}>
                      {d().completed_at ? "Completed" : "Created"} {date()}
                    </text>
                  )}
                </Show>
                <Show when={d().external_url}>
                  {(url) => <Link href={url()} fg={theme().primary} wrapMode="none" />}
                </Show>
              </>
            )}
          </Show>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    // Below the Context/usage panel (order 100) so usage stays at the top of the
    // sidebar content while the bound task sits right beneath it.
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
