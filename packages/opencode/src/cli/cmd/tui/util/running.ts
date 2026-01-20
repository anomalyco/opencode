const MAX_LEN = 40

export function extractToolCommand(tool: string, input: Record<string, unknown>): string {
  let cmd = ""

  switch (tool) {
    case "bash":
      cmd = (input.command as string) || "bash"
      break
    case "grep":
      cmd = `rg "${input.pattern}"${input.path ? ` ${input.path}` : ""}`
      break
    case "glob":
      cmd = `glob ${input.pattern}`
      break
    case "read":
      cmd = `read ${(input.filePath as string)?.split("/").pop() || input.filePath}`
      break
    case "write":
      cmd = `write ${(input.filePath as string)?.split("/").pop() || input.filePath}`
      break
    case "edit":
      cmd = `edit ${(input.filePath as string)?.split("/").pop() || input.filePath}`
      break
    case "task":
      cmd = `task: ${(input.description as string) || "..."}`
      break
    case "webfetch":
      cmd = `fetch ${input.url}`
      break
    default:
      cmd = (input.title as string) || tool
  }

  return cmd.length > MAX_LEN ? cmd.slice(0, MAX_LEN - 3) + "..." : cmd
}
