import type { CommandOption } from "@/shell/commands/command"

export function parseClientSlashCommand(options: readonly CommandOption[], text: string) {
  if (!text.startsWith("/")) return
  const separator = text.search(/\s/)
  const name = text.slice(1, separator === -1 ? undefined : separator)
  const option = options.find((item) => !item.disabled && item.slashArguments && item.slash === name)
  if (!option) return
  return {
    id: option.id,
    input: separator === -1 ? "" : text.slice(separator).trim(),
  }
}
