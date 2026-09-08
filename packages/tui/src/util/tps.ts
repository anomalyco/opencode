// Average characters per output token. Used to estimate live generation
// throughput while exact token counts are still streaming (they only
// materialize at step-finish). Final averages always use real counts.
export const CHARS_PER_TOKEN = 4

export function estimateOutputTokens(chars: number) {
  if (!chars) return 0
  return Math.floor(chars / CHARS_PER_TOKEN)
}

export function calcTps(outputTokens: number, elapsedMs: number) {
  if (outputTokens <= 0 || elapsedMs <= 0) return 0
  return outputTokens / (elapsedMs / 1000)
}

export function formatTps(tps: number) {
  if (!Number.isFinite(tps) || tps <= 0) return undefined
  return `${tps.toFixed(1)} t/s`
}

export * as Tps from "./tps"
