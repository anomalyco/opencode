import { defer } from "@/util/defer"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliRenderer } from "@opentui/core"
import { spawnSync } from "child_process"
import { $ } from "bun"

// ANSI escape sequences for terminal control
const CLEAR_SCREEN = "\x1b[2J" // CSI Erase in Display - clears entire screen
const CURSOR_HOME = "\x1b[H" // CSI Cursor Position - moves cursor to home (1,1)
const CLEAR_AND_RESET = CLEAR_SCREEN + CURSOR_HOME

export namespace Editor {
  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) return

    // Editor requires a TTY to work properly
    if (!process.stdin.isTTY) return

    const filepath = join(tmpdir(), `${Date.now()}.md`)
    await using _ = defer(async () => rm(filepath, { force: true }))

    await Bun.write(filepath, opts.value)

    // Save current terminal settings (echo, special chars, etc.) to restore after editor exits
    // We use stty to capture ALL terminal state, not just raw mode
    const sttyResult = await $`stty -g`.nothrow().quiet()
    const sttySettings = sttyResult?.exitCode === 0 ? sttyResult.text().trim() : undefined

    // Track raw mode separately - needed for explicit state management before resume()
    // This complements stty by ensuring renderer knows correct raw mode state
    const wasRawMode = process.stdin.isRaw

    // Remove all stdin listeners to give editor exclusive access
    // This prevents OpenTUI handlers from consuming keystrokes meant for the editor
    process.stdin.removeAllListeners("data")
    process.stdin.removeAllListeners("keypress")

    // Disable raw mode before suspending
    if (wasRawMode) {
      process.stdin.setRawMode(false)
    }

    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()

    // Clear the screen and reset cursor to avoid artifacts
    process.stdout.write(CLEAR_AND_RESET)

    // Use shell to properly parse editor command (handles flags, quoted paths, etc.)
    // Security note: EDITOR env var is user-controlled, so shell usage is safe
    const result = spawnSync(`${editor} "${filepath}"`, {
      stdio: "inherit",
      shell: true,
    })

    // Always restore terminal state (whether editor succeeded or failed)
    if (sttySettings) await $`stty ${sttySettings}`.nothrow().quiet()
    if (wasRawMode) process.stdin.setRawMode(true)
    process.stdout.write(CLEAR_AND_RESET)
    opts.renderer.resume()
    opts.renderer.requestRender()

    // Early return on spawn error
    if (result.error) return

    // On success: read and return edited content
    const content = await Bun.file(filepath).text()
    return content || undefined
  }
}
