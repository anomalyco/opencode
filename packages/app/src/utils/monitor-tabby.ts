/**
 * Tabby — mood derivation + i18n quip factory.
 *
 * Mirrors the opencode-side `packages/opencode/src/monitor/tabby.ts`
 * shape. The state machine is intentionally pure and synchronous so it
 * can run inside Solid memos. The bus snapshot is fed by the SSE
 * subscriber in `monitor-sse.ts`.
 */

import type { Mood } from "./monitor-schema"

export interface BusSnapshot {
  active_sessions: number
  errored_sessions: number
  last_event_at: number | null
  last_error_at: number | null
  connected: boolean
}

export function deriveMood(snapshot: BusSnapshot, now: number): Mood {
  if (!snapshot.connected) return "disconnected"
  if (snapshot.errored_sessions > 0) return "worried"
  if (snapshot.last_error_at && now - snapshot.last_error_at < 60_000) return "worried"
  if (snapshot.active_sessions === 0) {
    if (snapshot.last_event_at && now - snapshot.last_event_at > 5 * 60_000) return "sleeping"
    return "idle"
  }
  if (snapshot.last_event_at && now - snapshot.last_event_at < 30_000) return "happy"
  return "watching"
}

const QUIPS: Record<Mood, { en: string; zh: string }> = {
  idle: { en: "All quiet on the agent front.", zh: "暂无活动。" },
  watching: { en: "Eyes on the live sessions.", zh: "正在观察实时会话。" },
  happy: { en: "Nice — that just wrapped cleanly!", zh: "刚刚跑完一个干净的回合。" },
  worried: { en: "Heads up — there's an errored session.", zh: "注意：有一个出错会话。" },
  stuck: { en: "Looks like nobody's moved in a while.", zh: "好像卡住了。" },
  thinking: { en: "A fresh session just kicked off.", zh: "新会话刚刚启动。" },
  sleeping: { en: "Quiet here. Step away anytime.", zh: "这里很安静。" },
  disconnected: { en: "Lost the live feed — reattaching…", zh: "实时连接断开 — 正在重连…" },
}

export function nextQuip(mood: Mood, lang: "en" | "zh" = "en"): string {
  return QUIPS[mood][lang]
}
