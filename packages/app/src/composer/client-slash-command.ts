type ClientSlashCommand = {
  id: string
  trigger: string
  arguments?: boolean
  type: "builtin" | "custom"
}

export function parseSlashCommand(text: string) {
  if (!text.startsWith("/")) return
  const separator = text.search(/\s/)
  const name = text.slice(1, separator === -1 ? undefined : separator)

  return { name, input: separator === -1 ? "" : text.slice(separator).trim() }
}

/** A configured command wins over a client command that takes arguments under the same name. */
export function withoutShadowedClientCommands<T extends ClientSlashCommand>(options: readonly T[]) {
  const custom = new Set(options.flatMap((item) => (item.type === "custom" ? [item.trigger] : [])))

  return options.filter((item) => item.type === "custom" || !item.arguments || !custom.has(item.trigger))
}

export function parseClientSlashCommand(options: readonly ClientSlashCommand[], text: string) {
  const command = parseSlashCommand(text)

  if (!command) return
  const option = options.find((item) => item.type === "builtin" && item.arguments && item.trigger === command.name)

  if (!option) return

  return {
    id: option.id,
    input: command.input,
  }
}
