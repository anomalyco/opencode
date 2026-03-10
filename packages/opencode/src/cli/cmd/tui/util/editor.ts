import openApp from "open"
import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

export namespace Editor {
  function editor() {
    return process.env["VISUAL"] || process.env["EDITOR"]
  }

  function parse(cmd: string) {
    return (cmd.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((part) => part.replace(/^("|')(.*)\1$/, "$2"))
  }

  async function launch(cmd: string, target: string, renderer?: CliRenderer) {
    const parts = parse(cmd)
    if (parts.length === 0) throw new Error("External editor command is empty")

    renderer?.suspend()
    renderer?.currentRenderBuffer.clear()

    try {
      const proc = Process.spawn([...parts, target], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      await proc.exited
    } finally {
      if (!renderer) return
      renderer.currentRenderBuffer.clear()
      renderer.resume()
      renderer.requestRender()
    }
  }

  export async function file(opts: { path: string; renderer?: CliRenderer }) {
    const cmd = editor()
    if (cmd) {
      await launch(cmd, opts.path, opts.renderer)
      return
    }

    await openApp(opts.path)
  }

  export async function dir(path: string) {
    await openApp(path)
  }

  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const cmd = editor()
    if (!cmd) return

    const filepath = join(tmpdir(), `${Date.now()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Filesystem.write(filepath, opts.value)
    await launch(cmd, filepath, opts.renderer)
    const content = await Filesystem.readText(filepath)
    return content || undefined
  }
}
