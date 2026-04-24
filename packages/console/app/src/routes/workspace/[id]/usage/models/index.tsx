import { Billing } from "@opencode-ai/console-core/billing.js"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, For, Show, createSignal, createEffect } from "solid-js"
import { formatDateUTC, formatDateForTable } from "../../../common"
import { withActor } from "~/context/auth.withActor"
import { IconChevronLeft, IconChevronRight, IconBreakdown } from "~/component/icon"
import styles from "./models-section.module.css"
import { useI18n } from "~/context/i18n"

const PAGE_SIZE = 20

async function getModelStats(workspaceID: string, days: number) {
  "use server"
  return withActor(async () => {
    return await Billing.modelStats(days)
  }, workspaceID)
}

const queryModelStats = query(getModelStats, "usage.models")

export function ModelsSection() {
  const params = useParams()
  const i18n = useI18n()
  const [days, setDays] = createSignal(30)

  const stats = createAsync(() => queryModelStats(params.id!, days()))

  const totalCost = createMemo(() => {
    const s = stats()
    if (!s) return 0
    return s.reduce((sum, m) => sum + m.totalCost, 0)
  })

  const totalRequests = createMemo(() => {
    const s = stats()
    if (!s) return 0
    return s.reduce((sum, m) => sum + m.requestCount, 0)
  })

  const totalInputTokens = createMemo(() => {
    const s = stats()
    if (!s) return 0
    return s.reduce((sum, m) => sum + m.totalInputTokens, 0)
  })

  const totalOutputTokens = createMemo(() => {
    const s = stats()
    if (!s) return 0
    return s.reduce((sum, m) => sum + m.totalOutputTokens, 0)
  })

  const totalCacheTokens = createMemo(() => {
    const s = stats()
    if (!s) return 0
    return s.reduce((sum, m) => sum + m.totalCacheReadTokens + m.totalCacheWriteTokens, 0)
  })

  const cacheSavings = createMemo(() => {
    const s = stats()
    if (!s) return 0
    // Cache tokens represent ~90% savings vs normal input tokens
    const cacheReads = s.reduce((sum, m) => sum + m.totalCacheReadTokens, 0)
    return cacheReads * 0.9 // Rough estimate of cost savings
  })

  const formatCost = (cents: number) => {
    return (cents / 100).toFixed(4)
  }

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toString()
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Model Statistics</h2>
        <p>Usage breakdown by remote model for the selected period</p>
      </div>

      <div data-slot="period-selector">
        <label>Period: </label>
        <select
          value={days()}
          onChange={(e) => setDays(parseInt(e.currentTarget.value))}
        >
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="60">Last 60 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      <div data-slot="summary-cards">
        <div class={styles.summaryCard}>
          <span class={styles.summaryLabel}>Total Cost</span>
          <span class={styles.summaryValue}>{formatCost(totalCost())}</span>
        </div>
        <div class={styles.summaryCard}>
          <span class={styles.summaryLabel}>Total Requests</span>
          <span class={styles.summaryValue}>{formatTokens(totalRequests())}</span>
        </div>
        <div class={styles.summaryCard}>
          <span class={styles.summaryLabel}>Input Tokens</span>
          <span class={styles.summaryValue}>{formatTokens(totalInputTokens())}</span>
        </div>
        <div class={styles.summaryCard}>
          <span class={styles.summaryLabel}>Output Tokens</span>
          <span class={styles.summaryValue}>{formatTokens(totalOutputTokens())}</span>
        </div>
        <div class={styles.summaryCard}>
          <span class={styles.summaryLabel}>Cache Tokens</span>
          <span class={styles.summaryValue}>{formatTokens(totalCacheTokens())}</span>
        </div>
        <div class={styles.summaryCard + " " + styles.savingsCard}>
          <span class={styles.summaryLabel}>Est. Cache Savings</span>
          <span class={styles.summaryValue}>{formatCost(cacheSavings())}</span>
        </div>
      </div>

      <div data-slot="models-table">
        <Show
          when={stats() && stats()!.length > 0}
          fallback={
            <div data-component="empty-state">
              <p>No usage data for this period</p>
            </div>
          }
        >
          <table data-slot="models-table-element">
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Requests</th>
                <th>Input Tokens</th>
                <th>Output Tokens</th>
                <th>Cache Read</th>
                <th>Cache Write</th>
                <th>Cost</th>
                <th>Avg Cost/Req</th>
              </tr>
            </thead>
            <tbody>
              <For each={stats()}>
                {(stat) => (
                  <tr>
                    <td data-slot="model-name" class={styles.modelCell}>
                      <span class={styles.modelName}>{stat.model}</span>
                    </td>
                    <td data-slot="provider">{stat.provider}</td>
                    <td data-slot="requests">{stat.requestCount.toLocaleString()}</td>
                    <td data-slot="input">{formatTokens(stat.totalInputTokens)}</td>
                    <td data-slot="output">{formatTokens(stat.totalOutputTokens)}</td>
                    <td data-slot="cache-read">
                      <span class={styles.cacheValue}>{formatTokens(stat.totalCacheReadTokens)}</span>
                    </td>
                    <td data-slot="cache-write">
                      <span class={styles.cacheValue}>{formatTokens(stat.totalCacheWriteTokens)}</span>
                    </td>
                    <td data-slot="cost" class={styles.costCell}>
                      {formatCost(stat.totalCost)}
                    </td>
                    <td data-slot="avg-cost">{(stat.avgCostPerRequest / 100).toFixed(4)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </section>
  )
}
