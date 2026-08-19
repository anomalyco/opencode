// Memory pressure thresholds and pure helpers, kept free of Electron and
// logging imports so they can be unit-tested in a plain Node/Bun context.

export const WARNING_BYTES = 1.5 * 1024 ** 3
export const ACTION_BYTES = 1.8 * 1024 ** 3

export type MemoryPressureLevel = "ok" | "warning" | "action"

export type ProcessMetric = {
  pid: number
  type: string
  name?: string
  memory: { workingSetSize: number; peakWorkingSetSize?: number }
}

// Electron reports workingSetSize in kilobytes.
export function peakWorkingSetBytes(metrics: readonly ProcessMetric[]): number {
  return metrics.reduce((peak, proc) => Math.max(peak, proc.memory.workingSetSize * 1024), 0)
}

export function pressureLevel(peakBytes: number): MemoryPressureLevel {
  if (peakBytes >= ACTION_BYTES) return "action"
  if (peakBytes >= WARNING_BYTES) return "warning"
  return "ok"
}
