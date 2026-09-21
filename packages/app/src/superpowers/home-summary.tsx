import type { OpenCodeEvent, RpcCallOptions, RpcClient } from "@opencode/client/promise"
import { ChangedSchema, ExecutionRpc, type RunSummary } from "@bearmanser/opencode-superpowers-execution/contract"
import { Show, createEffect, onCleanup, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { eventLocationDirectory, preferredRun, type ExecutionEventSource } from "./bridge-client"
import { scopeKey, type ExecutionScope } from "./identity"
import type { ExecutionModel } from "./model"

const CHANGED_EVENT = "rpc.superpowers.execution.v1.changed"

export function summaryBatches(rootSessionIDs: string[]) {
  const unique = [...new Set(rootSessionIDs)]
  return Array.from({ length: Math.ceil(unique.length / 50) }, (_, index) =>
    unique.slice(index * 50, index * 50 + 50),
  )
}

export type HomeSummaryRequest = {
  serverKey: string
  ownerDirectory: string
  rootSessionIDs: string[]
}

export function homeSummaryRequests(scopes: ExecutionScope[]): HomeSummaryRequest[] {
  const grouped = new Map<string, ExecutionScope[]>()
  for (const scope of scopes) {
    const key = JSON.stringify([scope.serverKey, scope.ownerDirectory])
    grouped.set(key, [...(grouped.get(key) ?? []), scope])
  }
  return [...grouped.values()].flatMap((group) => {
    const { serverKey, ownerDirectory } = group[0]!
    return summaryBatches(group.map((scope) => scope.rootSessionID)).map((rootSessionIDs) => ({
      serverKey,
      ownerDirectory,
      rootSessionIDs,
    }))
  })
}

export type HomeSummaryEntry = {
  summary: RunSummary
  stale: boolean
}

export function createHomeExecutionSummaries(input: {
  serverKey: Accessor<string | undefined>
  roots: Accessor<ExecutionScope[]>
  api: Accessor<RpcClient<typeof ExecutionRpc, RpcCallOptions> | undefined>
  events: Accessor<ExecutionEventSource | undefined>
  connection: Accessor<boolean>
}) {
  const [summaries, setSummaries] = createStore<Record<string, RunSummary | undefined>>({})
  const [failures, setFailures] = createStore<Record<string, boolean | undefined>>({})
  let generation = 0
  let loadedKey: string | undefined
  let activeServerKey: string | undefined
  let controller: AbortController | undefined
  let listener: ExecutionEventSource | undefined
  let unsubscribe: (() => void) | undefined
  let disposed = false

  function selected() {
    const serverKey = input.serverKey()
    if (!serverKey) return []
    const seen = new Set<string>()
    return input.roots().filter((root) => {
      if (root.serverKey !== serverKey) return false
      const key = scopeKey(root)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function entry(scope: ExecutionScope): HomeSummaryEntry | undefined {
    const key = scopeKey(scope)
    if (!selected().some((root) => scopeKey(root) === key)) return
    const summary = summaries[key]
    if (!summary) return
    return { summary, stale: !input.connection() || !!failures[key] }
  }

  function batchScope(request: HomeSummaryRequest, rootSessionID: string): ExecutionScope {
    return { serverKey: request.serverKey, ownerDirectory: request.ownerDirectory, rootSessionID }
  }

  async function load(requests: HomeSummaryRequest[], requestGeneration: number) {
    const api = input.api()
    if (!api) return
    controller = new AbortController()
    const signal = controller.signal
    const results = await Promise.all(
      requests.map(async (batch) => ({
        batch,
        page: await api
          .getSummaries(
            { rootSessionIDs: batch.rootSessionIDs },
            { location: { directory: batch.ownerDirectory }, signal },
          )
          .catch(() => undefined),
      })),
    )
    if (disposed || generation !== requestGeneration) return
    for (const { batch, page } of results) {
      if (!page) {
        for (const rootSessionID of batch.rootSessionIDs) setFailures(scopeKey(batchScope(batch, rootSessionID)), true)
        continue
      }
      const items = new Map<string, RunSummary[]>()
      for (const item of page.items) {
        items.set(item.rootSessionID, [...(items.get(item.rootSessionID) ?? []), item])
      }
      for (const rootSessionID of batch.rootSessionIDs) {
        setFailures(scopeKey(batchScope(batch, rootSessionID)), false)
        setSummaries(scopeKey(batchScope(batch, rootSessionID)), preferredRun(items.get(rootSessionID) ?? []))
      }
    }
  }

  function onChanged(event: OpenCodeEvent) {
    if (disposed || event.type !== CHANGED_EVENT) return
    const directory = eventLocationDirectory(event)
    if (!directory) return
    const parsed = ChangedSchema.safeParse(event.data)
    if (!parsed.success) return
    const tracked = selected().some(
      (root) => root.ownerDirectory === directory && root.rootSessionID === parsed.data.rootSessionID,
    )
    if (!tracked) return
    loadedKey = undefined
    refresh()
  }

  function ensureListener() {
    const events = input.events()
    if (events === listener) return
    unsubscribe?.()
    unsubscribe = events?.listen(onChanged)
    listener = events
  }

  function clearIdentity(serverKey: string | undefined) {
    if (serverKey === activeServerKey) return
    activeServerKey = serverKey
    loadedKey = undefined
    controller?.abort()
    setSummaries(reconcile({}))
    setFailures(reconcile({}))
  }

  function refresh() {
    if (disposed) return
    ensureListener()
    clearIdentity(input.serverKey())
    if (!input.connection()) {
      loadedKey = undefined
      controller?.abort()
      return
    }
    const api = input.api()
    const selectedRoots = selected()
    if (!api || selectedRoots.length === 0) {
      loadedKey = undefined
      return
    }
    const requests = homeSummaryRequests(selectedRoots)
    const key = JSON.stringify(requests)
    if (key === loadedKey) return
    loadedKey = key
    generation += 1
    controller?.abort()
    void load(requests, generation)
  }

  createEffect(refresh)

  onCleanup(() => {
    disposed = true
    generation += 1
    controller?.abort()
    unsubscribe?.()
  })

  return {
    entry,
    reconcile: refresh,
  }
}

const [pendingOverview, setPendingOverview] = createStore<Record<string, boolean | undefined>>({})

export function requestExecutionOverview(sessionID: string) {
  setPendingOverview(sessionID, true)
}

export function consumeExecutionOverview(sessionID: string | undefined) {
  if (!sessionID || !pendingOverview[sessionID]) return false
  setPendingOverview(sessionID, undefined)
  return true
}

export function openExecutionOverview(input: {
  execution: ExecutionModel
  openTab: () => void
  showMobile: () => void
}) {
  input.execution.selectSubview("agents")
  input.openTab()
  input.showMobile()
}

export function ExecutionHomeSummary(props: { summary: RunSummary; stale?: boolean; onOpen: () => void }) {
  const language = useLanguage()
  return (
    <button
      type="button"
      data-testid="execution-summary"
      data-status={props.summary.status}
      data-stale={String(!!props.stale)}
      aria-label={language.t("execution.status.open")}
      class={`
        flex h-6 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[12px] leading-4
        text-v2-text-text-muted [font-weight:530] transition-[background-color,color] duration-[120ms]
        ease-in-out motion-reduce:transition-none hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base
        focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none
      `}
      onClick={() => props.onOpen()}
    >
      <span data-testid="execution-summary-count">
        {language.t("execution.progress.count", {
          verified: props.summary.progress.verified,
          total: props.summary.progress.total,
        })}
      </span>
      <Show when={props.summary.status === "cancelled"}>
        <span data-testid="execution-summary-state" class="text-v2-text-text-faint">
          {language.t("execution.runState.cancelled")}
        </span>
      </Show>
      <Show when={props.stale}>
        <span data-testid="execution-summary-stale" class="text-v2-text-text-faint">
          {language.t("execution.home.stale")}
        </span>
      </Show>
    </button>
  )
}
