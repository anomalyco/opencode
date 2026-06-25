export type SlashCommand = {
  name: string
}

export function resolvePromptSlashCommand(inputText: string, commands: readonly SlashCommand[]) {
  if (!inputText.startsWith("/")) return

  const firstLineEnd = inputText.indexOf("\n")
  const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
  const [rawCommand, ...firstLineArgs] = firstLine.split(" ")
  const name = rawCommand.slice(1)
  if (!name) return
  if (!commands.some((command) => command.name === name)) return

  const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
  const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")
  return {
    name,
    arguments: args,
  }
}
