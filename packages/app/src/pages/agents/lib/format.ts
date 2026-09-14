export const RATE_MIN_OUT = 50;
export interface TokenCounts { input: number; output: number; reasoning: number }
export interface CacheUsage { input: number; cache: { read: number } }
export function tok(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return String(Math.trunc(n));
  const units = ["k", "M", "G", "T"];
  let v = n / 1000;
  let i = 0;
  while (i < units.length - 1 && Math.round(v * 10) / 10 >= 1000) { v /= 1000; i++; }
  if (Math.round(v * 10) / 10 >= 1000) return "999T+";
  return v.toFixed(1) + units[i];
}
export function rateText(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  if (v < 10) return (v as number).toFixed(1);
  const r = Math.round(v);
  return r > 9999 ? "9999" : String(r);
}
export function money(v: number): string {
  if (Number.isNaN(v)) return "—";
  if (!Number.isFinite(v)) return v > 0 ? "999B+" : "-999B+";
  const tiers: Array<[number, number, string]> = [[1,2,""],[1,1,""],[1e3,2,"k"],[1e3,1,"k"],[1e6,2,"M"],[1e6,1,"M"],[1e9,2,"B"],[1e9,1,"B"],[1e9,0,"B"]];
  for (const [div, dec, suf] of tiers) {
    const scaled = v / div;
    if (!Number.isFinite(scaled) || Math.abs(scaled) >= 1e15) continue;
    let s = scaled.toFixed(dec) + suf;
    if (Number(scaled.toFixed(dec)) === 0) s = (0).toFixed(dec) + suf;
    if (s.length <= 6) return s;
  }
  return v < 0 ? "-999B+" : "999B+";
}
export function pctText(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${Math.floor(v)}%`;
}
export function latText(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || (seconds as number) < 0) return "—";
  const s = seconds as number;
  if (s < 1) { const ms = `${Math.round(s * 1000)}ms`; return ms.length <= 5 ? ms : s.toFixed(1) + "s"; }
  if (s < 10) return s.toFixed(1) + "s";
  if (s < 100) return `${Math.round(s)}s`;
  return "99s+";
}
export function isRateWorthy(out: number): boolean {
  return Number.isFinite(out) && out >= RATE_MIN_OUT;
}
export function tokTotal(t: { input: number; output: number; reasoning: number }): number {
  return t.input + t.output + t.reasoning;
}
export function cacheShare(t: { input: number; cache: { read: number } }): number {
  const inp = t.input, read = t.cache?.read;
  if (!Number.isFinite(inp) || !Number.isFinite(read) || inp <= 0 || read <= 0) return 0;
  return Math.min(1, Math.max(0, read / inp));
}
