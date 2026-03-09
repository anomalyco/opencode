import type { UserMessage } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, on } from "solid-js"
import { createStore } from "solid-js/store"
import { same } from "@/utils/same"

export const emptyUserMessages: UserMessage[] = []

export type SessionHistoryWindowInput = {
  sessionID: () => string | undefined
  messagesReady: () => boolean
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  loadMore: (sessionID: string) => Promise<void>
  userScrolled: () => boolean
  scroller: () => HTMLDivElement | undefined
}

type Snap = {
  top: number
  height: number
  gap: number
  max: number
}

export const historyLoadMode = (input: { start: number; more: boolean; loading: boolean }) => {
  if (input.start > 0) return "reveal"
  if (!input.more || input.loading) return "noop"
  return "fetch"
}

export const historyRevealTop = (
  mark: { top: number; height: number; gap: number; max: number },
  next: { clientHeight: number; height: number },
  threshold = 16,
) => {
  const delta = next.height - mark.height
  if (delta <= 0) return mark.top
  if (mark.max <= 0) return mark.top
  if (mark.gap > threshold) return mark.top

  const max = next.height - next.clientHeight
  if (max <= 0) return 0
  return Math.max(-max, Math.min(0, mark.top - delta))
}

const snap = (el: HTMLDivElement | undefined): Snap | undefined => {
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  return {
    top: el.scrollTop,
    height: el.scrollHeight,
    gap: max + el.scrollTop,
    max,
  }
}

const clamp = (el: HTMLDivElement, top: number) => {
  const max = el.scrollHeight - el.clientHeight
  if (max <= 0) return 0
  return Math.max(-max, Math.min(0, top))
}

const revealThreshold = 16

const reveal = (input: SessionHistoryWindowInput, mark: Snap | undefined) => {
  const el = input.scroller()
  if (!el || !mark) return
  el.scrollTop = clamp(
    el,
    historyRevealTop(mark, { clientHeight: el.clientHeight, height: el.scrollHeight }, revealThreshold),
  )
}

const preserve = (input: SessionHistoryWindowInput, fn: () => void) => {
  const el = input.scroller()
  if (!el) {
    fn()
    return
  }
  const top = el.scrollTop
  fn()
  el.scrollTop = top
}

/**
 * Maintains the rendered history window for a session timeline.
 *
 * It keeps initial paint bounded to recent turns, reveals cached turns in
 * small batches while scrolling upward, and prefetches older history near top.
 */
export function createSessionHistoryWindow(input: SessionHistoryWindowInput) {
  const turnInit = 10
  const turnBatch = 8
  const turnScrollThreshold = 200
  const turnPrefetchBuffer = 16
  const prefetchCooldownMs = 400
  const prefetchNoGrowthLimit = 2

  const [state, setState] = createStore({
    turnID: undefined as string | undefined,
    turnStart: 0,
    prefetchUntil: 0,
    prefetchNoGrowth: 0,
  })

  const initialTurnStart = (len: number) => (len > turnInit ? len - turnInit : 0)

  const turnStart = createMemo(() => {
    const id = input.sessionID()
    const len = input.visibleUserMessages().length
    if (!id || len <= 0) return 0
    if (state.turnID !== id) return initialTurnStart(len)
    if (state.turnStart <= 0) return 0
    if (state.turnStart >= len) return initialTurnStart(len)
    return state.turnStart
  })

  const setTurnStart = (start: number) => {
    const id = input.sessionID()
    const next = start > 0 ? start : 0
    if (!id) {
      setState({ turnID: undefined, turnStart: next })
      return
    }
    setState({ turnID: id, turnStart: next })
  }

  const renderedUserMessages = createMemo(
    () => {
      const msgs = input.visibleUserMessages()
      const start = turnStart()
      if (start <= 0) return msgs
      return msgs.slice(start)
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )

  const backfillTurns = () => {
    const start = turnStart()
    if (start <= 0) return

    const next = start - turnBatch
    const nextStart = next > 0 ? next : 0

    preserve(input, () => setTurnStart(nextStart))
  }

  /** Button path: reveal cached turns first, then fetch older history. */
  const loadAndReveal = async () => {
    const id = input.sessionID()
    if (!id) return

    const start = turnStart()
    const mode = historyLoadMode({
      start,
      more: input.historyMore(),
      loading: input.historyLoading(),
    })

    if (mode === "reveal") {
      const mark = snap(input.scroller())
      setTurnStart(0)
      reveal(input, mark)
      return
    }

    if (mode === "noop") return

    const beforeVisible = input.visibleUserMessages().length
    const mark = snap(input.scroller())

    await input.loadMore(id)
    if (input.sessionID() !== id) return

    const afterVisible = input.visibleUserMessages().length
    const growth = afterVisible - beforeVisible
    if (growth <= 0) return
    if (state.prefetchNoGrowth) setState("prefetchNoGrowth", 0)

    reveal(input, mark)
  }

  /** Scroll/prefetch path: fetch older history from server. */
  const fetchOlderMessages = async (opts?: { prefetch?: boolean }) => {
    const id = input.sessionID()
    if (!id) return
    if (!input.historyMore() || input.historyLoading()) return

    if (opts?.prefetch) {
      const now = Date.now()
      if (state.prefetchUntil > now) return
      if (state.prefetchNoGrowth >= prefetchNoGrowthLimit) return
      setState("prefetchUntil", now + prefetchCooldownMs)
    }

    const start = turnStart()
    const beforeVisible = input.visibleUserMessages().length
    const beforeRendered = start <= 0 ? beforeVisible : renderedUserMessages().length

    await input.loadMore(id)
    if (input.sessionID() !== id) return

    const afterVisible = input.visibleUserMessages().length
    const growth = afterVisible - beforeVisible

    if (opts?.prefetch) {
      setState("prefetchNoGrowth", growth > 0 ? 0 : state.prefetchNoGrowth + 1)
    } else if (growth > 0 && state.prefetchNoGrowth) {
      setState("prefetchNoGrowth", 0)
    }

    if (growth <= 0) return
    if (turnStart() !== start) return

    const revealMore = !opts?.prefetch
    const currentRendered = renderedUserMessages().length
    const base = Math.max(beforeRendered, currentRendered)
    const target = revealMore ? Math.min(afterVisible, base + turnBatch) : base
    const nextStart = Math.max(0, afterVisible - target)
    preserve(input, () => setTurnStart(nextStart))
  }

  const onScrollerScroll = () => {
    if (!input.userScrolled()) return
    const el = input.scroller()
    if (!el) return
    if (el.scrollHeight - el.clientHeight + el.scrollTop >= turnScrollThreshold) return

    const start = turnStart()
    if (start > 0) {
      if (start <= turnPrefetchBuffer) {
        void fetchOlderMessages({ prefetch: true })
      }
      backfillTurns()
      return
    }

    void fetchOlderMessages()
  }

  createEffect(
    on(
      input.sessionID,
      () => {
        setState({ prefetchUntil: 0, prefetchNoGrowth: 0 })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [input.sessionID(), input.messagesReady()] as const,
      ([id, ready]) => {
        if (!id || !ready) return
        setTurnStart(initialTurnStart(input.visibleUserMessages().length))
      },
      { defer: true },
    ),
  )

  return {
    turnStart,
    setTurnStart,
    renderedUserMessages,
    loadAndReveal,
    onScrollerScroll,
  }
}
