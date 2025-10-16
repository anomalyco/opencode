import { ConfigMarkdown } from "../config/markdown"
import { $ } from "bun"
import { Instance } from "../project/instance"
import path from "path"
import os from "os"
import fs from "fs/promises"

export namespace Template {
  const BASH_REGEX = /!`([^`]+)`/g

  /**
   * Process a template string by executing bash commands and replacing file references
   * @param template The template string to process
   * @returns The processed template with bash commands executed and file references replaced
   */
  export async function process(template: string): Promise<string> {
    let result = template

    // First, process shell commands (!`command`)
    const shell = ConfigMarkdown.shell(result)
    if (shell.length > 0) {
      const shellResults = await Promise.all(
        shell.map(async ([, cmd]) => {
          try {
            return await $`${{ raw: cmd }}`.nothrow().text()
          } catch (error) {
            return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
          }
        }),
      )

      let shellIndex = 0
      result = result.replace(BASH_REGEX, () => shellResults[shellIndex++])
    }

    // Then, process file references (@file/path)
    const files = ConfigMarkdown.files(result)
    if (files.length > 0) {
      const fileResults = await Promise.all(
        files.map(async (match) => {
          const name = match[1]
          const worktree = Instance.worktree
          // If worktree is root, use the Instance.directory instead (handles non-git directories)
          const baseDir = worktree === "/" ? Instance.directory : worktree
          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.isAbsolute(name)
              ? name
              : path.resolve(baseDir, name)

          try {
            const stats = await fs.stat(filepath)
            if (stats.isFile()) {
              return await Bun.file(filepath).text()
            } else if (stats.isDirectory()) {
              // For directories, return a listing
              const files = await fs.readdir(filepath)
              return `Directory contents of ${name}:\n${files.map((f) => `- ${f}`).join("\n")}`
            }
          } catch (error) {
            return `Error reading file ${name}: ${error instanceof Error ? error.message : String(error)}`
          }
          return `File not found: ${name}`
        }),
      )

      // Replace file references with their content
      files.forEach((match, index) => {
        result = result.replace(match[0], fileResults[index])
      })
    }

    return result
  }
}
