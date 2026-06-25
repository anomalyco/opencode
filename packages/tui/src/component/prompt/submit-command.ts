type CommandInfo = {
  name: string
}

export type PromptSlashCommand = {
  command: string
  arguments: string
}

export function parsePromptSlashCommand(
  inputText: string,
  commands: readonly CommandInfo[],
): PromptSlashCommand | undefined {
  if (!inputText.startsWith("/")) return

  const firstLineEnd = inputText.indexOf("\n")
  const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
  const [head, ...firstLineArgs] = firstLine.split(" ")
  const command = head.slice(1)
  if (!command) return
  if (!commands.some((item) => item.name === command)) return

  const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
  return {
    command,
    arguments: firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : ""),
  }
}
