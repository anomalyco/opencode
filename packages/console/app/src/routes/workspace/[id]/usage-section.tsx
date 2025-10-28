import { Billing } from "@opencode-ai/console-core/billing.js"
import { query, useParams, createAsync } from "@solidjs/router"
import { createMemo, For, Show } from "solid-js"
import { formatDateUTC, formatDateForTable } from "../common"
import { withActor } from "~/context/auth.withActor"
import styles from "./usage-section.module.css"

const getUsageInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.usages()
  }, workspaceID)
}, "usage.list")

export function UsageSection() {
  const params = useParams()
  // ORIGINAL CODE - COMMENTED OUT FOR TESTING
  const usage = createAsync(() => getUsageInfo(params.id))

  // DUMMY DATA FOR TESTING
  // const usage = () => [
  //   {
  //     timeCreated: new Date(Date.now() - 86400000 * 0).toISOString(), // Today
  //     model: "claude-3-5-sonnet-20241022",
  //     inputTokens: 1247,
  //     outputTokens: 423,
  //     cost: 125400000, // $1.254
  //   },
  //   {
  //     timeCreated: new Date(Date.now() - 86400000 * 0.5).toISOString(), // 12 hours ago
  //     model: "claude-3-haiku-20240307",
  //     inputTokens: 892,
  //     outputTokens: 156,
  //     cost: 23500000, // $0.235
  //   },
  //   {
  //     timeCreated: new Date(Date.now() - 86400000 * 1).toISOString(), // Yesterday
  //     model: "claude-3-5-sonnet-20241022",
  //     inputTokens: 2134,
  //     outputTokens: 687,
  //     cost: 234700000, // $2.347
  //   },
  //   {
  //     timeCreated: new Date(Date.now() - 86400000 * 1.3).toISOString(), // 1.3 days ago
  //     model: "gpt-4o-mini",
  //     inputTokens: 567,
  //     outputTokens: 234,
  //     cost: 8900000, // $0.089
  //   },
  //   {
  //     timeCreated: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
  //     model: "claude-3-opus-20240229",
  //     inputTokens: 1893,
  //     outputTokens: 945,
  //     cost: 445600000, // $4.456
  //   },
  //   {
  //     timeCreated: new Date(Date.now() - 86400000 * 2.7).toISOString(), // 2.7 days ago
  //     model: "gpt-4o",
  //     inputTokens: 1456,
  //     outputTokens: 532,
  //     cost: 156800000, // $1.568
  //   },
  //   {
  //     timeCreated: new Date(Date.now() - 86400000 * 3).toISOString(), // 3 days ago
  //     model: "claude-3-haiku-20240307",
  //     inputTokens: 634,
  //     outputTokens: 89,
  //     cost: 12300000, // $0.123
  //   },
  //   {
  //     timeCreated: new Date(Date.now() - 86400000 * 4).toISOString(), // 4 days ago
  //     model: "claude-3-5-sonnet-20241022",
  //     inputTokens: 3245,
  //     outputTokens: 1123,
  //     cost: 387200000, // $3.872
  //   },
  // ]

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Usage History</h2>
        <p>Recent API usage and costs.</p>
      </div>
      <div data-slot="usage-table">
        <Show
          when={usage() && usage()!.length > 0}
          fallback={
            <div data-component="empty-state">
              <p>Make your first API call to get started.</p>
            </div>
          }
        >
          <table data-slot="usage-table-element">
            <thead>
              <tr>
                <th>Date</th>
                <th>Model</th>
                <th>Input</th>
                <th>Output</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              <For each={usage()!}>
                {(usage) => {
                  const date = createMemo(() => new Date(usage.timeCreated))
                  return (
                    <tr>
                      <td data-slot="usage-date" title={formatDateUTC(date())}>
                        {formatDateForTable(date())}
                      </td>
                      <td data-slot="usage-model">{usage.model}</td>
                      <td data-slot="usage-tokens">{usage.inputTokens}</td>
                      <td data-slot="usage-tokens">{usage.outputTokens}</td>
                      <td data-slot="usage-cost">${((usage.cost ?? 0) / 100000000).toFixed(4)}</td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </section>
  )
}
