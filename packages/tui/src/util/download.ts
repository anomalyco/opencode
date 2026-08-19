import type { Progress } from "@opencode-ai/core/download"

export type DownloadProgress = Progress

const phases = new Set<Progress["phase"]>(["starting", "downloading", "verifying", "completed"])

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function parseDownloadProgress(value: unknown): DownloadProgress | undefined {
  const data = record(value)
  if (!data) return

  const phase =
    typeof data.phase === "string" && phases.has(data.phase as Progress["phase"])
      ? (data.phase as Progress["phase"])
      : undefined
  const url = typeof data.url === "string" ? data.url : undefined
  const filePath = typeof data.filePath === "string" ? data.filePath : undefined
  const receivedBytes = finite(data.receivedBytes)
  const bytesPerSecond = finite(data.bytesPerSecond)
  const elapsedMs = finite(data.elapsedMs)
  if (
    !phase ||
    !url ||
    !filePath ||
    receivedBytes === undefined ||
    bytesPerSecond === undefined ||
    elapsedMs === undefined
  )
    return

  const totalBytes = finite(data.totalBytes)
  const percent = finite(data.percent)
  return {
    phase,
    url,
    filePath,
    receivedBytes: Math.max(0, receivedBytes),
    ...(totalBytes === undefined ? {} : { totalBytes: Math.max(0, totalBytes) }),
    ...(percent === undefined ? {} : { percent: Math.min(100, Math.max(0, percent)) }),
    bytesPerSecond: Math.max(0, bytesPerSecond),
    elapsedMs: Math.max(0, elapsedMs),
  }
}

export function formatDownloadBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** index
  const digits = index === 0 || scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  return `${scaled.toFixed(digits)} ${units[index]}`
}

export function formatDownloadDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s"
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const minuteRest = minutes % 60
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`
}

export function downloadPercent(progress: DownloadProgress): number | undefined {
  if (progress.phase === "completed" || progress.phase === "verifying") return 100
  if (progress.percent !== undefined) return Math.min(100, Math.max(0, progress.percent))
  if (progress.totalBytes && progress.totalBytes > 0)
    return Math.min(100, Math.max(0, (progress.receivedBytes / progress.totalBytes) * 100))
}

export function downloadProgressBar(progress: DownloadProgress, width = 22): string {
  const size = Math.max(8, Math.floor(width))
  const percent = downloadPercent(progress)
  if (percent !== undefined) {
    const filled = Math.min(size, Math.max(0, Math.round((percent / 100) * size)))
    return `${"█".repeat(filled)}${"░".repeat(size - filled)}`
  }

  const segment = Math.min(5, Math.max(3, Math.floor(size / 4)))
  const travel = size + segment
  const offset = Math.floor(progress.elapsedMs / 250) % travel
  return Array.from({ length: size }, (_, index) => {
    const distance = (index - offset + travel) % travel
    return distance < segment ? "█" : "░"
  }).join("")
}

export function downloadEta(progress: DownloadProgress): string | undefined {
  if (!progress.totalBytes || progress.bytesPerSecond <= 0 || progress.receivedBytes >= progress.totalBytes) return
  return formatDownloadDuration(((progress.totalBytes - progress.receivedBytes) / progress.bytesPerSecond) * 1000)
}

export function downloadDetail(progress: DownloadProgress): string {
  const size = progress.totalBytes
    ? `${formatDownloadBytes(progress.receivedBytes)} / ${formatDownloadBytes(progress.totalBytes)}`
    : formatDownloadBytes(progress.receivedBytes)
  const rate = progress.bytesPerSecond > 0 ? `${formatDownloadBytes(progress.bytesPerSecond)}/s` : "calculating speed"
  const eta = downloadEta(progress)
  return [size, rate, eta ? `${eta} remaining` : undefined].filter(Boolean).join(" · ")
}
