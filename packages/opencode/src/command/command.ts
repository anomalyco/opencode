import { Global } from "../global"
import path from "path"
import { App } from "../app/app.ts"
import { z } from "zod"
import fs from "fs"
import yaml from "js-yaml"
import { Message } from "../session/message.ts"
import type { Tool } from "../tool/tool.ts"

export namespace Commands {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      allowedTools: z.array(z.string()).optional(),
      prompt: z.string(),
    })
    .strict()
    .openapi({
      ref: "Command.Info",
    })
  export type Info = z.output<typeof Info>

  export const transform = (msg: {
    sessionID: string
    providerID: string
    modelID: string
    parts: Message.Part[]
    system?: string[]
    tools?: Tool.Info[]
  }) => {
    msg.parts = msg.parts.map((p) => {
      if (p.type != "text") {
        return p
      }
      const txt = p.text.trim()
      if (!txt.startsWith("/")) {
        return p
      }
      const [command, ...args] = txt.slice(1).split(" ")

      const cmd = state().find(x => x.name == command)
      if (!cmd) {
        return p
      }

      p.text = cmd.prompt.replaceAll("$ARGUMENTS", args.join(" "))

      return p
    })
    return msg
  }

  export const state = App.state("commands", (app: App.Info) => {
    return [
      ...loadFromPath("user", path.join(Global.Path.config, "commands")),
      ...loadFromPath("project", path.join(app.path.root, ".opencode", "commands")),
      // TODO: load available commands from registered MCP servers
    ]
  })

  export function loadFromPath(prefix: string, dir: string): Info[] {
    try {
      // Check if the directory exists
      if (!fs.existsSync(dir)) {
        return []
      }

      return fs
        .readdirSync(dir, {
          withFileTypes: true,
          recursive: true,
        })
        .filter((f) => f.isFile() && path.extname(f.name) === ".md")
        .map((f: fs.Dirent) => {
          // Get the full path of the file
          const filePath = path.join(f.parentPath, f.name)

          // Get the relative path from the base directory
          const relativePath = path.relative(dir, filePath)

          // Create the command name: prefix:path:segments:filename
          const pathSegments = path.dirname(relativePath) !== '.' 
            ? path.dirname(relativePath).replace(/[\\/]/g, ":") + ":" 
            : ""
          const commandName = `${prefix}:${pathSegments}${path.basename(relativePath, ".md")}`

          // Read the file content
          const content = fs.readFileSync(filePath, "utf-8")

          // Parse frontmatter
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

          if (!frontmatterMatch) {
            // If no frontmatter, return with just the name and prompt
            return {
              name: commandName,
              prompt: content,
            }
          }

          const [, frontmatterYaml, promptContent] = frontmatterMatch

          try {
            const frontmatter = yaml.load(frontmatterYaml) as Record<string, any>

            return {
              name: commandName,
              description: frontmatter["description"],
              allowedTools: frontmatter["allowed-tools"],
              prompt: promptContent.trim(),
            }
          } catch (e) {
            // If YAML parsing fails, return with just the name and prompt
            return {
              name: commandName,
              prompt: content,
            }
          }
        })
    } catch (error) {
      console.error(`Error loading commands from ${dir}:`, error)
      return []
    }
  }
}
