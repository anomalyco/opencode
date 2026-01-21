import { Billing } from "@opencode-ai/console-core/billing.js"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, For, Show, createEffect, createSignal } from "solid-js"
import { formatDateUTC, formatDateForTable } from "../common"
import { withActor } from "~/context/auth.withActor"
import { IconChevronLeft, IconChevronRight, IconBreakdown } from "~/component/icon"
import styles from "./usage-section.module.css"
import { createStore } from "solid-js/store"

const PAGE_SIZE = 50

async function getUsageInfo(workspaceID: string, page: number) {
  "use server"
  return withActor(async () => {
    return await Billing.usages(page, PAGE_SIZE)
  }, workspaceID)
}

const queryUsageInfo = query(getUsageInfo, "usage.list")

export function UsageSection() {
  const params = useParams()
  const usage = createAsync(() => queryUsageInfo(params.id!, 0))
  const [store, setStore] = createStore({ page: 0, usage: [] as Awaited<ReturnType<typeof getUsageInfo>> })
  const [openBreakdownId, setOpenBreakdownId] = createSignal<string | null>(null)

  createEffect(() => {
    setStore({ usage: usage() })
  }, [usage])

  createEffect(() => {
    if (!openBreakdownId()) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-slot="tokens-with-breakdown"]')) {
        setOpenBreakdownId(null)
      }
    }

    document.addEventListener("click", handleClickOutside)
    return () => document.removeEventListener("click", handleClickOutside)
  })

  const hasResults = createMemo(() => store.usage && store.usage.length > 0)
  const canGoPrev = createMemo(() => store.page > 0)
  const canGoNext = createMemo(() => store.usage && store.usage.length === PAGE_SIZE)

  const calculateTotalInputTokens = (u: Awaited<ReturnType<typeof getUsageInfo>>[0]) => {
    return u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWrite5mTokens ?? 0) + (u.cacheWrite1hTokens ?? 0)
  }

  const calculateTotalOutputTokens = (u: Awaited<ReturnType<typeof getUsageInfo>>[0]) => {
    return u.outputTokens + (u.reasoningTokens ?? 0)
  }

  const goPrev = async () => {
    const usage = await getUsageInfo(params.id!, store.page - 1)
    setStore({
      page: store.page - 1,
      usage,
    })
  }
  const goNext = async () => {
    const usage = await getUsageInfo(params.id!, store.page + 1)
    setStore({
      page: store.page + 1,
      usage,
    })
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Usage History</h2>
        <p>Recent API usage and costs.</p>
      </div>
      <div data-slot="usage-table">
        <Show
          when={hasResults()}
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
              <For each={store.usage}>
                {(usage, index) => {
                  const date = createMemo(() => new Date(usage.timeCreated))
                  const totalInputTokens = createMemo(() => calculateTotalInputTokens(usage))
                  const totalOutputTokens = createMemo(() => calculateTotalOutputTokens(usage))
                  const inputBreakdownId = `input-breakdown-${index()}`
                  const outputBreakdownId = `output-breakdown-${index()}`
                  const isInputOpen = createMemo(() => openBreakdownId() === inputBreakdownId)
                  const isOutputOpen = createMemo(() => openBreakdownId() === outputBreakdownId)
                  const isClaude = usage.model.toLowerCase().includes("claude")
                  return (
                    <tr>
                      <td data-slot="usage-date" title={formatDateUTC(date())}>
                        {formatDateForTable(date())}
                      </td>
                      <td data-slot="usage-model">{usage.model}</td>
                      <td data-slot="usage-tokens">
                        <div data-slot="tokens-with-breakdown" onClick={(e) => e.stopPropagation()}>
                          <button
                            data-slot="breakdown-button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenBreakdownId(isInputOpen() ? null : inputBreakdownId)
                            }}
                          >
                            <IconBreakdown />
                          </button>
                          <span onClick={() => setOpenBreakdownId(null)}>{totalInputTokens()}</span>
                          <Show when={isInputOpen()}>
                            <div data-slot="breakdown-popup" onClick={(e) => e.stopPropagation()}>
                              <div data-slot="breakdown-row">
                                <span data-slot="breakdown-label">Input</span>
                                <span data-slot="breakdown-value">{usage.inputTokens}</span>
                              </div>
                              <div data-slot="breakdown-row">
                                <span data-slot="breakdown-label">Cache Read</span>
                                <span data-slot="breakdown-value">{usage.cacheReadTokens ?? 0}</span>
                              </div>
                              <Show when={isClaude}>
                                <div data-slot="breakdown-row">
                                  <span data-slot="breakdown-label">Cache Write</span>
                                  <span data-slot="breakdown-value">{usage.cacheWrite5mTokens ?? 0}</span>
                                </div>
                              </Show>
                            </div>
                          </Show>
                        </div>
                      </td>
                      <td data-slot="usage-tokens">
                        <div data-slot="tokens-with-breakdown" onClick={(e) => e.stopPropagation()}>
                          <button
                            data-slot="breakdown-button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenBreakdownId(isOutputOpen() ? null : outputBreakdownId)
                            }}
                          >
                            <IconBreakdown />
                          </button>
                          <span onClick={() => setOpenBreakdownId(null)}>{totalOutputTokens()}</span>
                          <Show when={isOutputOpen()}>
                            <div data-slot="breakdown-popup" onClick={(e) => e.stopPropagation()}>
                              <div data-slot="breakdown-row">
                                <span data-slot="breakdown-label">Output</span>
                                <span data-slot="breakdown-value">{usage.outputTokens}</span>
                              </div>
                              <div data-slot="breakdown-row">
                                <span data-slot="breakdown-label">Reasoning</span>
                                <span data-slot="breakdown-value">{usage.reasoningTokens ?? 0}</span>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </td>
                      <td data-slot="usage-cost">
                        ${usage.enrichment?.plan === "sub" ? "0.0000" : ((usage.cost ?? 0) / 100000000).toFixed(4)}
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
          <Show when={canGoPrev() || canGoNext()}>
            <div data-slot="pagination">
              <button disabled={!canGoPrev()} onClick={goPrev}>
                <IconChevronLeft />
              </button>
              <button disabled={!canGoNext()} onClick={goNext}>
                <IconChevronRight />
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  )
}
