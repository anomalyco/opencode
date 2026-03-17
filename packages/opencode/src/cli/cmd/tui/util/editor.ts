import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

/**
 * Editor namespace providing functionality to open an external text editor.
 *
 * Allows users to edit text using their preferred editor (specified by the
 * VISUAL or EDITOR environment variables). The editor opens with a temporary
 * file containing the initial value, and the edited content is returned after
 * the editor closes.
 *
 * @example
 * ```typescript
 * const result = await Editor.open({
 *   value: "Initial text",
 *   renderer: cliRenderer
 * })
 * if (result) {
 *   console.log("Edited text:", result)
 * }
 * ```
 */
export namespace Editor {
  /**
   * Opens the system's default text editor with the provided initial value.
   *
   * Creates a temporary file with the initial content, opens it in the editor
   * specified by VISUAL or EDITOR environment variable, waits for the editor
   * to close, then returns the edited content. The temporary file is automatically
   * cleaned up.
   *
   * @param opts - Options including the initial value and CLI renderer
   * @returns A promise resolving to the edited text, or undefined if no editor is configured
   */
  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) return

    const filepath = join(tmpdir(), `${Date.now()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Filesystem.write(filepath, opts.value)
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()
    try {
      const parts = editor.split(" ")
      const proc = Process.spawn([...parts, filepath], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        shell: process.platform === "win32",
      })
      await proc.exited
      const content = await Filesystem.readText(filepath)
      return content || undefined
    } finally {
      opts.renderer.currentRenderBuffer.clear()
      opts.renderer.resume()
      opts.renderer.requestRender()
    }
  }
}
