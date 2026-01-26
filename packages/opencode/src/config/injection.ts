import { $ } from "bun"
import { PermissionNext } from "../permission/next"
import { Instance } from "../project/instance"

export namespace Injection {
  const SHELL_REGEX = /!`([^`]+)`/g

  export async function process(content: string, sessionID?: string): Promise<string> {
    const matches = Array.from(content.matchAll(SHELL_REGEX))
    if (matches.length === 0) return content

    let result = content
    for (const match of matches) {
      const fullMatch = match[0]
      const command = match[1]

      if (sessionID) {
        await PermissionNext.ask({
          permission: "bash",
          patterns: [command],
          always: [],
          sessionID,
          metadata: {
            description: `Executing command for context injection: ${command}`,
          },
          ruleset: [],
        })
      }

      try {
        const output = await $`${{ raw: command }}`.cwd(Instance.directory).quiet().text()
        result = result.replace(fullMatch, output.trim())
      } catch (error) {
        const errorMessage = `Error executing command "${command}": ${error instanceof Error ? error.message : String(error)}`
        result = result.replace(fullMatch, errorMessage)
      }
    }

    return result
  }
}
