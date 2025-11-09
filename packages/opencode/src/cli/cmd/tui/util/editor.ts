import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"

export namespace Editor {
  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env["EDITOR"]
    if (!editor) return

    const filepath = join(tmpdir(), `${Date.now()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Bun.write(filepath, opts.value)
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()
    const parts = editor.split(" ").filter(Boolean)

    // Validate all parts are strings
    const cmd: string[] = [...parts, filepath]
    for (let i = 0; i < cmd.length; i++) {
      if (typeof cmd[i] !== "string") {
        throw new Error(`Invalid command argument at index ${i}: expected string, got ${typeof cmd[i]}`)
      }
    }

    const proc = Bun.spawn({
      cmd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    await proc.exited
    const content = await Bun.file(filepath).text()
    opts.renderer.currentRenderBuffer.clear()
    opts.renderer.resume()
    opts.renderer.requestRender()
    return content || undefined
  }
}
