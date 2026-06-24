/**
 * Tabby — floating mascot.
 *
 * Concept carried over from CCAM (MIT) with the SVG asset & 8-mood state
 * machine re-implemented natively. The mascot is driven by the live bus
 * stream and surfaces throttled, coalesced speech bubbles on notable
 * events.
 *
 * Moods:
 *
 *   idle          | no live sessions
 *   watching      | one or more live sessions, no errors
 *   happy         | a session just finished cleanly
 *   worried       | a session produced an error
 *   stuck         | inactivity rule fired
 *   thinking      | a session started / just spawned a subagent
 *   sleeping      | user is away (no input for a while)
 *   disconnected  | bus subscription dropped
 *
 * State derivation is purely functional. The UI layer (Solid component
 * in `packages/app`) consumes `deriveMood()` and `nextQuip()`.
 */

import { z } from "zod"

export const Mood = z.enum([
  "idle",
  "watching",
  "happy",
  "worried",
  "stuck",
  "thinking",
  "sleeping",
  "disconnected",
])
export type Mood = z.infer<typeof Mood>

export const BusSnapshot = z.object({
  active_sessions: z.number().int().min(0),
  errored_sessions: z.number().int().min(0),
  last_event_at: z.number().nullable(),
  last_error_at: z.number().nullable(),
  connected: z.boolean(),
})
export type BusSnapshot = z.infer<typeof BusSnapshot>

/**
 * Derive the mascot's mood from the current snapshot.
 *
 * Order matters: more specific states win. `disconnected` short-circuits
 * everything (we cannot reason about bus state if the socket is gone).
 */
export function deriveMood(snapshot: BusSnapshot, now: number): Mood {
  if (!snapshot.connected) return "disconnected"
  if (snapshot.errored_sessions > 0) return "worried"
  if (snapshot.last_error_at && now - snapshot.last_error_at < 60_000) return "worried"
  if (snapshot.active_sessions === 0) {
    if (snapshot.last_event_at && now - snapshot.last_event_at > 5 * 60_000) return "sleeping"
    return "idle"
  }
  // any active session: watching unless we just saw a success event in the
  // last 30s, in which case happy takes over for a brief celebration.
  if (snapshot.last_event_at && now - snapshot.last_event_at < 30_000) return "happy"
  return "watching"
}

/**
 * Pick a single short quip for the current mood. Throttling / coalescing
 * belongs to the UI layer — this function is the deterministic prompt
 * factory.
 */
export function nextQuip(mood: Mood, lang: "en" | "zh" | "vi" = "en"): string {
  const quips: Record<Mood, Record<typeof lang, string>> = {
    idle: { en: "All quiet on the agent front.", zh: "暂无活动。", vi: "Yên ắng cả rồi." },
    watching: { en: "Eyes on the live sessions.", zh: "正在观察实时会话。", vi: "Đang canh các session đang chạy." },
    happy: { en: "Nice — that just wrapped cleanly!", zh: "刚刚跑完一个干净的回合。", vi: "Vừa xong một lượt sạch đẹp!" },
    worried: { en: "Heads up — there's an errored session.", zh: "注意：有一个出错会话。", vi: "Cảnh báo — có session đang lỗi." },
    stuck: { en: "Looks like nobody's moved in a while.", zh: "好像卡住了。", vi: "Có vẻ đang kẹt một lúc rồi." },
    thinking: { en: "A fresh session just kicked off.", zh: "新会话刚刚启动。", vi: "Vừa khởi động session mới." },
    sleeping: { en: "Quiet here. Step away anytime.", zh: "这里很安静。", vi: "Yên quá — đi pha trà đi." },
    disconnected: { en: "Lost the live feed — reattaching…", zh: "实时连接断开 — 正在重连…", vi: "Mất kết nối — đang thử lại…" },
  }
  return quips[mood][lang]
}