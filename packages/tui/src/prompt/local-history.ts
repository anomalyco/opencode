export const MAX_LOCAL_COMMAND_HISTORY = 20
export const MAX_LOCAL_COMMAND_OUTPUT_DISPLAY = 8 * 1024
export const MAX_LOCAL_COMMAND_OUTPUT_LINES = 12

export type LocalCommandHistoryEntry = {
  command: string
  output: string
  failed: boolean
}

export function appendLocalCommandHistory(entries: LocalCommandHistoryEntry[], entry: LocalCommandHistoryEntry) {
  const suffix = "\n\nOutput shortened for Local shell history."
  const displayed = entry.output
    .slice(0, MAX_LOCAL_COMMAND_OUTPUT_DISPLAY - suffix.length)
    .split("\n")
    .slice(0, MAX_LOCAL_COMMAND_OUTPUT_LINES)
    .join("\n")
  const output = displayed.length < entry.output.length ? `${displayed}${suffix}` : displayed
  return [...entries, { ...entry, output }].slice(-MAX_LOCAL_COMMAND_HISTORY)
}

export function moveLocalCommandHistory(
  entries: LocalCommandHistoryEntry[],
  index: number,
  direction: -1 | 1,
): { command: string; index: number } | undefined {
  if (!entries.length) return undefined
  const next = Math.max(-entries.length, Math.min(0, index + direction))
  if (next === index) return undefined
  return {
    command: next === 0 ? "" : entries.at(next)!.command,
    index: next,
  }
}
