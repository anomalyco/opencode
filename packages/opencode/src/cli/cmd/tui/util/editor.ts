import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"

export namespace Editor {
  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) return

    const filepath = join(tmpdir(), `${Date.now()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Bun.write(filepath, opts.value)
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()

    const shellEscapedFilepath = `'${filepath.replace(/'/g, "'\\''")}'`
    const isWindows = process.platform === "win32"
    const shellCommand = isWindows ? `${editor} "${filepath}"` : `${editor} ${shellEscapedFilepath}`

    const proc = Bun.spawn({
      cmd: isWindows ? ["cmd", "/c", shellCommand] : ["sh", "-c", shellCommand],
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
