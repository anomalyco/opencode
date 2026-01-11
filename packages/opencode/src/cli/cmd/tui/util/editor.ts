import { defer } from "@/util/defer"
import { randomBytes } from "node:crypto"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"

export namespace Editor {
  /**
   * Opens editor for user input.
   *
   * SECURITY MODEL:
   * - Trusts VISUAL/EDITOR environment variables (Unix standard)
   * - Follows Git's implementation pattern (shell invocation)
   * - Users control these variables and already have shell access
   * - This is NOT for server-side use with untrusted input
   *
   * PLATFORM NOTES:
   * - Unix: Secure single-quote escaping (POSIX-compliant)
   * - Windows: Input validation to prevent cmd.exe injection
   *   See: https://flatt.tech/research/posts/batbadbut-you-cant-securely-execute-commands-on-windows/
   */
  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) return

    const randomSuffix = randomBytes(4).toString("hex").slice(0, 8)
    const filepath = join(tmpdir(), `${Date.now()}-${randomSuffix}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Bun.write(filepath, opts.value)
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()

    const isWindows = process.platform === "win32"

    if (isWindows) {
      // Windows: Validate filepath to prevent cmd.exe injection
      // Percent signs (%) enable environment variable expansion that bypasses quotes
      // Other special characters like ^, &, |, <, > can also cause issues
      const safePathRegex = /^[a-zA-Z0-9_\-\.\\\/:]+$/
      if (!safePathRegex.test(filepath)) {
        throw new Error("Filepath contains unsafe characters for Windows cmd.exe")
      }
    }

    const shellEscapedFilepath = `'${filepath.replace(/'/g, "'\\''")}'`
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
