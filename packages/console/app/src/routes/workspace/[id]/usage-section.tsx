import { Billing } from "@opencode-ai/console-core/billing.js"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, For, Show, createEffect } from "solid-js"
import { formatDateUTC, formatDateForTable } from "../common"
import { withActor } from "~/context/auth.withActor"
import "./usage-section.module.css"
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

  createEffect(() => {
    setStore({ usage: usage() })
  }, [usage])

  const hasResults = createMemo(() => store.usage && store.usage.length > 0)
  const canGoPrev = createMemo(() => store.page > 0)
  const canGoNext = createMemo(() => store.usage && store.usage.length === PAGE_SIZE)

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
    <section>
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
          <Show when={canGoPrev() || canGoNext()}>
            <div data-slot="pagination">
              <button disabled={!canGoPrev()} onClick={goPrev}>
                ←
              </button>
              <button disabled={!canGoNext()} onClick={goNext}>
                →
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  )
}
