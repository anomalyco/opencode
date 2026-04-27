import type { Agent } from "@opencode-ai/sdk/v2/client"

export type HermesRow = {
  id: string
  tools: string[]
  extra: number
}

export type HermesMeta = {
  version?: string
  upstream?: string
  total: number
  rows: HermesRow[]
}

export type HermesView = {
  cols: number
  rows: HermesRow[]
  shown: number
  total: number
  moreRows: number
  moreTools: number
}

export function hermesMeta(list: Agent[] | undefined) {
  const item = list?.find((agent) => agent.name === "hermes")
  const raw = item?.options?.hermes
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return

  const rows = Array.isArray((raw as { rows?: unknown }).rows)
    ? (raw as { rows: unknown[] }).rows.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const id = typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : ""
        const extra = typeof (item as { extra?: unknown }).extra === "number" ? (item as { extra: number }).extra : 0
        const tools = Array.isArray((item as { tools?: unknown }).tools)
          ? (item as { tools: unknown[] }).tools.filter((tool): tool is string => typeof tool === "string")
          : []
        if (!id || tools.length === 0) return []
        return [{ id, extra, tools } satisfies HermesRow]
      })
    : []

  return {
    version: typeof (raw as { version?: unknown }).version === "string" ? (raw as { version: string }).version : undefined,
    upstream:
      typeof (raw as { upstream?: unknown }).upstream === "string" ? (raw as { upstream: string }).upstream : undefined,
    total: typeof (raw as { total?: unknown }).total === "number" ? (raw as { total: number }).total : 0,
    rows,
  } satisfies HermesMeta
}

function caps(input: { width: number; height: number }) {
  const wide = input.width
  const tall = input.height
  const cols = wide >= 1600 ? 2 : 1

  let row = 3
  if (tall >= 840) row = 4
  if (tall >= 1040) row = 5
  if (tall >= 1500) row = 6
  row = row * cols

  let tool = 2
  if (wide >= 900) tool = 3
  if (wide >= 1200) tool = 4
  if (wide >= 1500) tool = 5
  if (wide >= 1850) tool = 6

  return { cols, row, tool }
}

export function hermesView(meta: HermesMeta | undefined, input: { width: number; height: number }) {
  if (!meta) return

  const cap = caps(input)
  const rows = meta.rows.slice(0, cap.row).map((row) => {
    const tools = row.tools.slice(0, cap.tool)
    const extra = row.extra + Math.max(0, row.tools.length - tools.length)
    return {
      id: row.id,
      tools,
      extra,
    } satisfies HermesRow
  })

  const shown = rows.reduce((sum, row) => sum + row.tools.length, 0)
  return {
    cols: cap.cols,
    rows,
    shown: rows.length,
    total: meta.rows.length,
    moreRows: Math.max(0, meta.rows.length - rows.length),
    moreTools: Math.max(0, meta.total - shown),
  } satisfies HermesView
}
