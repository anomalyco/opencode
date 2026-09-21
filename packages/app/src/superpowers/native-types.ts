import type { TokenUsage } from "./telemetry"

export type NativeUsage = {
  cost?: number
  tokens?: TokenUsage
}

export type NativeRecord = {
  id: string
  parentID?: string
  title: string
  directory: string
  status: "running" | "idle" | "unknown"
  needsInput: boolean
  error?: string
  model?: { id: string; providerID: string }
  activity?: string
  usage?: NativeUsage
}
