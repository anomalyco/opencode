import { NamedError } from "@opencode-ai/util/error"
import path from "path"
import z from "zod"
import { Bus } from "@/bus"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import { Log } from "@/util/log"
import { ConfigMarkdown } from "./markdown"
import { ConfigPaths } from "./paths"

export namespace ConfigCommands {
  const log = Log.create({ service: "config.commands" })

  export type Command = {
    template: string
    description?: string
    agent?: string
    model?: string
    subtask?: boolean
  }

  export function schema(model: z.ZodType<string>) {
    return z.object({
      template: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: model.optional(),
      subtask: z.boolean().optional(),
    })
  }

  function rel(item: string, patterns: string[]) {
    const file = item.replaceAll("\\", "/")
    for (const pattern of patterns) {
      const index = file.indexOf(pattern)
      if (index === -1) continue
      return file.slice(index + pattern.length)
    }
  }

  function trim(file: string) {
    const ext = path.extname(file)
    return ext.length ? file.slice(0, -ext.length) : file
  }

  async function text(file: string) {
    const mime = Filesystem.mimeType(file)
    if (mime.startsWith("text/")) return true

    const sample = (await Filesystem.readBytes(file)).subarray(0, 4096)
    if (!sample.length) return true

    const bad = sample.reduce((sum, byte) => {
      if (byte === 0) return sample.length
      if (byte < 9 || (byte > 13 && byte < 32)) return sum + 1
      return sum
    }, 0)
    return bad / sample.length <= 0.3
  }

  export async function load(dir: string, cmd: z.ZodType<Command>) {
    const result: Record<string, Command> = {}
    for (const item of await Glob.scan("{command,commands}/**/*", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      if (!(await text(item))) continue
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse command ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load command", { command: item, err })
        return undefined
      })
      if (!md) continue

      const file = rel(item, ["/.opencode/command/", "/.opencode/commands/", "/command/", "/commands/"])
      const name = trim(file ?? path.basename(item))
      const parsed = cmd.safeParse({
        name,
        ...md.data,
        template: md.content.trim(),
      })
      if (parsed.success) {
        result[name] = parsed.data
        continue
      }
      throw new ConfigPaths.InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }
}
