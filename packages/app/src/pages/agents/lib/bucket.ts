export const WINDOW_SECS = { "5m": 300, "1h": 3600, "24h": 86400 } as const;
export type WindowKey = keyof typeof WINDOW_SECS;
export const SPARK_N = 18;
export interface TokenTick {
  t: number;
  out: number;
  sessionID: string;
  turnID?: string;
  parentID?: string;
}
export const RESET_TRIGGERS = ["reset", "compact", "clear"] as const;
export type ResetTrigger = (typeof RESET_TRIGGERS)[number];
export function resetOn(trigger: string): "reset" | null {
  return (RESET_TRIGGERS as readonly string[]).includes(trigger) ? "reset" : null;
}
function zeros(n: number): number[] {
  return new Array(n).fill(0);
}
export function bucketize(ticks: TokenTick[], now: number, secs: number): number[] {
  const out = zeros(SPARK_N);
  if (!Number.isFinite(now) || !Number.isFinite(secs) || secs <= 0) return out;
  const start = now - secs;
  const width = secs / SPARK_N;
  if (!Number.isFinite(width) || width <= 0) return out;
  for (const tick of ticks) {
    if (!tick) continue;
    const t = tick.t;
    if (!Number.isFinite(t)) continue;
    if (t < start) continue;
    if (t > now + 1) continue;
    let idx: number;
    if (t > now) {
      idx = SPARK_N - 1;
    } else {
      idx = Math.floor((t - start) / width);
      if (idx < 0) continue;
      if (idx >= SPARK_N) idx = SPARK_N - 1;
    }
    let v = tick.out;
    if (!Number.isFinite(v) || v < 0) v = 0;
    out[idx] += v;
  }
  return out;
}
export function rollingOut1m(ticks: TokenTick[], now: number): number {
  if (!Number.isFinite(now)) return 0;
  const lo = now - 60;
  let sum = 0;
  for (const tick of ticks) {
    if (!tick) continue;
    const t = tick.t;
    if (!Number.isFinite(t)) continue;
    if (t <= lo) continue;
    if (t > now) continue;
    let v = tick.out;
    if (!Number.isFinite(v) || v < 0) v = 0;
    sum += v;
  }
  return sum;
}
export function sumSparks(...sparks: number[][]): number[] {
  if (sparks.length === 0) return zeros(SPARK_N);
  const len = Math.max(...sparks.map((s) => (Array.isArray(s) ? s.length : 0)));
  if (!Number.isFinite(len) || len <= 0) return [];
  const acc = zeros(len);
  for (const s of sparks) {
    if (!Array.isArray(s)) continue;
    for (let i = 0; i < s.length; i++) {
      const v = s[i];
      acc[i] += Number.isFinite(v) ? v : 0;
    }
  }
  return acc;
}
export function dedupeForks(ticks: TokenTick[]): TokenTick[] {
  const firstSessionByTurn = new Map<string, string>();
  const kept: TokenTick[] = [];
  for (const tick of ticks) {
    if (!tick) continue;
    const turn = tick.turnID;
    if (turn == null || turn === "") {
      kept.push(tick);
      continue;
    }
    const seen = firstSessionByTurn.get(turn);
    if (seen === undefined) {
      firstSessionByTurn.set(turn, tick.sessionID);
      kept.push(tick);
      continue;
    }
    if (seen === tick.sessionID) {
      kept.push(tick);
      continue;
    }
    continue;
  }
  return kept;
}
