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
}
