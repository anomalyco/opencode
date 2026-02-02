const MAX_LEN = 40
export const RUNNING_THRESHOLD_MS = 1000

export type RunningItem = {
  id: string
  label: string
  startTime?: number
  suffix?: string
  subtext?: string
  isAgent?: boolean
  children?: RunningItem[]
}

// Helper to safely coerce unknown to string
export function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + "..." : str
}

function basename(filepath: unknown): string {
  const path = str(filepath)
  return path.split("/").pop() || path
}

// Overrides for tools that need custom formatting
const TOOL_OVERRIDES: Record<string, (input: Record<string, unknown>) => string> = {
  grep: (input) => `rg "${input.pattern}"${input.path ? ` ${input.path}` : ""}`,
  task: (input) => `agent: ${str(input.description) || "..."}`,
}

export function extractToolCommand(tool: string, input: Record<string, unknown>): string {
  // Check for override first
  const override = TOOL_OVERRIDES[tool]
  if (override) return truncate(override(input), MAX_LEN)

  // Pattern-based fallback for common input fields
  if (input.command) return truncate(str(input.command), MAX_LEN)
  if (input.filePath) return truncate(`${tool} ${basename(input.filePath)}`, MAX_LEN)
  if (input.pattern) return truncate(`${tool} ${input.pattern}`, MAX_LEN)
  if (input.url) return truncate(`${tool} ${input.url}`, MAX_LEN)
  if (input.title) return truncate(str(input.title), MAX_LEN)
  if (input.description) return truncate(`${tool}: ${input.description}`, MAX_LEN)

  return tool
}
