import { ConfigMarkdown } from "../config/markdown"
import { $ } from "bun"

export namespace Template {
  const BASH_REGEX = /!`([^`]+)`/g

  /**
   * Process a template string by executing any bash commands inside !`...` syntax
   * @param template The template string to process
   * @returns The processed template with bash commands executed and replaced
   */
  export async function process(template: string): Promise<string> {
    const shell = ConfigMarkdown.shell(template)
    if (shell.length === 0) {
      return template
    }

    const results = await Promise.all(
      shell.map(async ([, cmd]) => {
        try {
          return await $`${{ raw: cmd }}`.nothrow().text()
        } catch (error) {
          return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
        }
      }),
    )

    let index = 0
    return template.replace(BASH_REGEX, () => results[index++])
  }
}
