import { Locale } from "@/util/locale"

export type Sample = {
  at: number
  tokens: number
}

const win = 15_000
const gap = 1_250
const stale = 1_500
const single = 1_000
const enc = new TextEncoder()

export function estimate(delta: string) {
  return Math.max(1, Math.ceil(enc.encode(delta).length / 4))
}

export function append(list: Sample[], input: { at?: number; delta: string }) {
  const at = input.at ?? Date.now()
  const next = list.filter((item) => at - item.at <= win)
  next.push({ at, tokens: estimate(input.delta) })
  return next
}

function active(list: Sample[], at: number) {
  if (list.length === 0) return 0
  if (list.length === 1) {
    const tail = Math.max(0, at - list[0].at)
    return Math.min(Math.max(tail, 250), single)
  }

  const span = list.reduce((sum, item, idx) => {
    if (idx === 0) return sum
    return sum + Math.min(Math.max(0, item.at - list[idx - 1].at), gap)
  }, 0)
  const tail = Math.min(Math.max(0, at - list[list.length - 1].at), gap)
  return Math.max(span + tail, single)
}

export function live(list: Sample[], at: number = Date.now()) {
  const next = list.filter((item) => at - item.at <= win)
  if (next.length === 0) return
  const last = next.at(-1)
  if (!last) return
  if (at - last.at > stale) return
  const tokens = next.reduce((sum, item) => sum + item.tokens, 0)
  return Locale.tokensPerSec(tokens, active(next, at))
}
