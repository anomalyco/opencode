export * as ShellProgress from "./shell-progress"

export type Snapshot = {
  readonly kind: "shell.progress"
  readonly label?: string
  readonly percent?: number
  readonly current?: number
  readonly total?: number
  readonly rate?: string
  readonly eta?: string
  readonly elapsed?: string
  readonly frame: string
  readonly frames: number
  readonly done?: boolean
}

export type State = {
  frames: number
  latest?: Snapshot
  lastPublishedAt: number
  lastPublishedKey?: string
}

const ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const BAR = /[|┃█▓▒░#=*>-]{3,}/g

export function makeState(): State {
  return { frames: 0, lastPublishedAt: 0 }
}

export function stripControl(input: string) {
  return input.replace(ANSI, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
}

const numberValue = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const suffix = value.at(-1)?.toLowerCase()
  const base = Number.parseFloat(/[km]$/i.test(value) ? value.slice(0, -1) : value)
  if (!Number.isFinite(base)) return undefined
  if (suffix === "k") return base * 1_000
  if (suffix === "m") return base * 1_000_000
  return base
}

export function parseFrame(input: string): Omit<Snapshot, "kind" | "frames"> | undefined {
  const frame = stripControl(input).trim()
  if (!frame) return undefined

  const percentMatch = frame.match(/(^|\s)(100|\d{1,2})(?:\.\d+)?%/)
  const ratioMatch = frame.match(/(\d+(?:\.\d+)?[kKmM]?)\s*\/\s*(\d+(?:\.\d+)?[kKmM]?)/)
  const rateMatch = frame.match(/\b(\d+(?:\.\d+)?\s*(?:it|B|KB|MB|GB)\/s)\b/i)
  const etaMatch = frame.match(/(?:ETA|eta)[:=\s]+([0-9:.]+)/) ?? frame.match(/<([0-9:.]+),\s*[^\]]+\]/)
  const elapsedMatch = frame.match(/\[([0-9:.]+)<[0-9:.]+,/) ?? frame.match(/(?:elapsed|Elapsed)[:=\s]+([0-9:.]+)/)

  if (!percentMatch && !ratioMatch && !rateMatch) return undefined
  if (!frame.includes("\r") && !percentMatch && !ratioMatch) return undefined

  const percent = percentMatch ? Math.min(100, Math.max(0, Number.parseFloat(percentMatch[2]))) : undefined
  const current = numberValue(ratioMatch?.[1])
  const total = numberValue(ratioMatch?.[2])
  const labelPrefix = frame.split(percentMatch?.[0] ?? ratioMatch?.[0] ?? rateMatch?.[0] ?? "", 1)[0]
  const label =
    labelPrefix
      ?.replace(BAR, " ")
      .trim()
      .replace(/[:|]+$/g, "") || undefined

  return {
    ...(label ? { label } : {}),
    ...(percent === undefined ? {} : { percent }),
    ...(current === undefined ? {} : { current }),
    ...(total === undefined ? {} : { total }),
    ...(rateMatch ? { rate: rateMatch[1].replace(/\s+/g, "") } : {}),
    ...(etaMatch ? { eta: etaMatch[1] } : {}),
    ...(elapsedMatch ? { elapsed: elapsedMatch[1] } : {}),
    frame,
    ...(percent === 100 || (current !== undefined && total !== undefined && current >= total) ? { done: true } : {}),
  }
}

const key = (snapshot: Snapshot) =>
  [snapshot.label, snapshot.percent, snapshot.current, snapshot.total, snapshot.rate, snapshot.eta, snapshot.done].join(
    "\0",
  )

export function observe(state: State, chunk: string, now = Date.now(), intervalMs = 750): Snapshot | undefined {
  let next: Snapshot | undefined
  for (const segment of chunk.split(/[\r\n]+/)) {
    const parsed = parseFrame(segment)
    if (!parsed) continue
    state.frames += 1
    next = { kind: "shell.progress", frames: state.frames, ...parsed }
    state.latest = next
  }
  if (!next || state.frames < 2) return undefined
  const nextKey = key(next)
  if (next.done || nextKey !== state.lastPublishedKey || now - state.lastPublishedAt >= intervalMs) {
    state.lastPublishedAt = now
    state.lastPublishedKey = nextKey
    return next
  }
  return undefined
}

const summary = (snapshot: Snapshot) => {
  const parts = ["progress:"]
  if (snapshot.label) parts.push(snapshot.label)
  if (snapshot.percent !== undefined) parts.push(`${snapshot.percent}%`)
  if (snapshot.current !== undefined && snapshot.total !== undefined)
    parts.push(`${snapshot.current}/${snapshot.total}`)
  if (snapshot.rate) parts.push(snapshot.rate)
  if (snapshot.eta && !snapshot.done) parts.push(`ETA ${snapshot.eta}`)
  return `[${parts.join(" ")}]`
}

export function cleanOutput(input: string) {
  const lines: string[] = []
  let frames = 0
  let latest: Snapshot | undefined

  for (const line of stripControl(input).replace(/\r\n/g, "\n").split("\n")) {
    if (!line.includes("\r")) {
      lines.push(line)
      continue
    }

    const kept: string[] = []
    for (const segment of line.split(/\r+/)) {
      const parsed = parseFrame(segment)
      if (parsed) {
        frames += 1
        latest = { kind: "shell.progress", frames, ...parsed }
        continue
      }
      if (segment.trim()) kept.push(segment)
    }
    lines.push(...kept)
  }

  const raw = lines.join("\n")
  const text = raw.replace(/\n{3,}/g, "\n\n").trim()
  if (!latest || frames < 2) return { output: raw, frames, latest }
  return { output: [summary(latest), text].filter(Boolean).join("\n"), frames, latest }
}
