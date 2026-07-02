export type TraceRecord = {
  readonly id: number
  readonly time: string
  readonly type: string
  readonly data?: unknown
}

const records: TraceRecord[] = []
let nextID = 0

export function add(type: string, data?: unknown) {
  const record = {
    id: ++nextID,
    time: new Date().toISOString(),
    type,
    ...(data === undefined ? {} : { data }),
  } satisfies TraceRecord
  records.push(record)
  return record
}

export function list() {
  return [...records]
}

export function clear() {
  records.length = 0
  nextID = 0
}

export function exportTrace() {
  return {
    records: list(),
  }
}

export * as SimulationTrace from "./trace"
