import { Tool } from "./tool"

export type BatchOut = Awaited<ReturnType<Tool.Def["execute"]>>
export type BatchRow = {
  out: BatchOut
}
type BatchMode = "parallel" | "sequential"

export function stableBatchKey(value: unknown) {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort())
}

export function batchList(values: Array<string | undefined>) {
  return [...new Set(values.filter(Boolean) as string[])]
}

export function batchResult<Mode extends BatchMode, Row extends BatchRow>(input: {
  title: string
  rows: Row[]
  mode: Mode
  deduped?: number
  coverage?: string[]
  call: (row: Row) => Record<string, unknown>
  label: (row: Row, index: number) => string
  result?: (row: Row, index: number) => Record<string, unknown>
  include_attachments?: boolean
  include_attachment_counts?: boolean
  include_result_output?: boolean
}) {
  const attachments = input.rows.flatMap((item) => item.out.attachments ?? [])
  const results = input.rows.map((item, i) => ({
    index: i + 1,
    ...(input.result?.(item, i) ?? {}),
    title: item.out.title,
    metadata: item.out.metadata,
    ...(input.include_result_output === false ? {} : { output: item.out.output }),
    ...(input.include_attachment_counts ? { attachments: item.out.attachments?.length ?? 0 } : {}),
  }))
  const metadata: {
    count: number
    deduped?: number
    coverage?: string[]
    calls: Array<Record<string, unknown>>
    results: typeof results
    parallel?: true
    sequential?: true
  } = {
    count: input.rows.length,
    calls: input.rows.map((item) => ({
      ...input.call(item),
      title: item.out.title,
      ...item.out.metadata,
    })),
    results,
    ...(input.mode === "parallel" ? { parallel: true as const } : { sequential: true as const }),
  }

  if (input.deduped !== undefined) metadata.deduped = input.deduped
  if (input.coverage) metadata.coverage = input.coverage

  return {
    title: input.title,
    metadata,
    output: input.rows
      .map((item, i) => [`[${i + 1}] ${input.label(item, i)}`, item.out.output].join("\n"))
      .join("\n\n"),
    ...(input.include_attachments && attachments.length ? { attachments } : {}),
  }
}
