import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"

export type PerformanceRow = {
  message: SessionMessageAssistant
  /** ms: time.created → 最初の出力 content の開始時刻。計算不能なら undefined */
  ttft?: number
  /** output + reasoning。tokens 未確定なら 0 */
  tokens: number
  /** ms: 最初の出力 content の開始時刻 → time.streamed。未完了なら undefined */
  generation?: number
  /** tokens / (generation / 1000)。generation か tokens が 0/undefined なら undefined */
  tps?: number
  /** ms: time.completed − time.created。未完了なら undefined */
  wall?: number
}

export type PerformanceSummary = {
  calls: number
  ttftMedian?: number
  /** Σtokens / (Σgeneration / 1000)(tps が定義された行のみ) */
  tps?: number
  /** Σwall(wall が定義された行のみ) */
  wall: number
}

export function getSessionPerformance(input: {
  messages: readonly SessionMessageInfo[]
  /** session.revert?.messageID。指定時はその message 以降を除外 */
  revert?: string
}): { rows: PerformanceRow[]; summary: PerformanceSummary } {
  const boundary = input.revert ? input.messages.findIndex((message) => message.id === input.revert) : -1
  const rows = (boundary >= 0 ? input.messages.slice(0, boundary) : input.messages)
    .filter((message) => message.type === "assistant")
    .map((message) => {
      const firstOutput = message.content
        .flatMap((item) => {
          if (item.type === "text" && item.time?.created) return [item.time.created]
          if (item.type === "reasoning" && item.time?.created) return [item.time.created]
          if (item.type === "tool") return [item.time.created]
          return []
        })
        .reduce<number | undefined>((min, time) => (min === undefined || time < min ? time : min), undefined)
      const ttft = firstOutput === undefined || firstOutput - message.time.created < 0 ? undefined : firstOutput - message.time.created
      const generation =
        message.time.streamed === undefined || firstOutput === undefined || message.time.streamed - firstOutput <= 0
          ? undefined
          : message.time.streamed - firstOutput
      const tokens = (message.tokens?.output ?? 0) + (message.tokens?.reasoning ?? 0)
      return {
        message,
        ttft,
        tokens,
        generation,
        tps: generation === undefined || tokens === 0 ? undefined : tokens / (generation / 1000),
        wall: message.time.completed === undefined ? undefined : message.time.completed - message.time.created,
      }
    })
    .toReversed()
  const ttfts = rows.flatMap((row) => (row.ttft === undefined ? [] : [row.ttft])).toSorted((a, b) => a - b)
  const measured = rows.filter((row) => row.tps !== undefined)
  return {
    rows,
    summary: {
      calls: rows.length,
      ttftMedian:
        ttfts.length === 0
          ? undefined
          : ttfts.length % 2 === 1
            ? ttfts[(ttfts.length - 1) / 2]
            : (ttfts[ttfts.length / 2 - 1] + ttfts[ttfts.length / 2]) / 2,
      tps:
        measured.length === 0
          ? undefined
          : measured.reduce((sum, row) => sum + row.tokens, 0) / (measured.reduce((sum, row) => sum + (row.generation ?? 0), 0) / 1000),
      wall: rows.reduce((sum, row) => sum + (row.wall ?? 0), 0),
    },
  }
}
