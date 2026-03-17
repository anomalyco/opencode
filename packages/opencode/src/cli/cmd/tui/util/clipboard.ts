import { platform, release } from "os"
import clipboardy from "clipboardy"
import { lazy } from "../../../../util/lazy.js"
import { tmpdir } from "os"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../../../util/filesystem"
import { Process } from "../../../../util/process"
import { which } from "../../../../util/which"

/**
 * Writes text to clipboard via OSC 52 escape sequence.
 * This allows clipboard operations to work over SSH by having
 * the terminal emulator handle the clipboard locally.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return
  const base64 = Buffer.from(text).toString("base64")
  const osc52 = `\x1b]52;c;${base64}\x07`
  const passthrough = process.env["TMUX"] || process.env["STY"]
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
  process.stdout.write(sequence)
}

/**
 * Clipboard namespace providing cross-platform clipboard operations.
 *
 * Supports reading and writing text to the system clipboard on macOS, Windows,
 * and Linux (X11 and Wayland). Also supports reading image data from the clipboard
 * and uses OSC 52 for SSH compatibility.
 *
 * @example
 * ```typescript
 * // Copy text to clipboard
 * await Clipboard.copy("Hello, World!")
 *
 * // Read from clipboard
 * const content = await Clipboard.read()
 * if (content) {
 *   console.log(content.data) // text or base64 image data
 * }
 * ```
 */
export namespace Clipboard {
  /**
   * Content interface for clipboard data.
   */
  export interface Content {
    /** The clipboard data as a string (text or base64-encoded binary) */
    data: string
    /** The MIME type of the content (e.g., "text/plain", "image/png") */
    mime: string
  }

  /**
   * Reads content from the system clipboard.
   *
   * Attempts to read image data first (PNG format) on supported platforms
   * (macOS, Windows/WSL, Linux with wl-paste/xclip). Falls back to text content
   * if no image is available.
   *
   * @returns A promise resolving to the clipboard content, or undefined if empty/unavailable
   */
  export async function read(): Promise<Content | undefined> {
    const os = platform()

    if (os === "darwin") {
      const tmpfile = path.join(tmpdir(), "opencode-clipboard.png")
      try {
        await Process.run(
          [
            "osascript",
            "-e",
            'set imageData to the clipboard as "PNGf"',
            "-e",
            `set fileRef to open for access POSIX file "${tmpfile}" with write permission`,
            "-e",
            "set eof fileRef to 0",
            "-e",
            "write imageData to fileRef",
            "-e",
            "close access fileRef",
          ],
          { nothrow: true },
        )
        const buffer = await Filesystem.readBytes(tmpfile)
        return { data: buffer.toString("base64"), mime: "image/png" }
      } catch {
      } finally {
        await fs.rm(tmpfile, { force: true }).catch(() => {})
      }
    }

    if (os === "win32" || release().includes("WSL")) {
      const script =
        "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }"
      const base64 = await Process.text(["powershell.exe", "-NonInteractive", "-NoProfile", "-command", script], {
        nothrow: true,
      })
      if (base64.text) {
        const imageBuffer = Buffer.from(base64.text.trim(), "base64")
        if (imageBuffer.length > 0) {
          return { data: imageBuffer.toString("base64"), mime: "image/png" }
        }
      }
    }

    if (os === "linux") {
      const wayland = await Process.run(["wl-paste", "-t", "image/png"], { nothrow: true })
      if (wayland.stdout.byteLength > 0) {
        return { data: Buffer.from(wayland.stdout).toString("base64"), mime: "image/png" }
      }
      const x11 = await Process.run(["xclip", "-selection", "clipboard", "-t", "image/png", "-o"], {
        nothrow: true,
      })
      if (x11.stdout.byteLength > 0) {
        return { data: Buffer.from(x11.stdout).toString("base64"), mime: "image/png" }
      }
    }

    const text = await clipboardy.read().catch(() => {})
    if (text) {
      return { data: text, mime: "text/plain" }
    }
  }

  const getCopyMethod = lazy(() => {
    const os = platform()

    if (os === "darwin" && which("osascript")) {
      console.log("clipboard: using osascript")
      return async (text: string) => {
        const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        await Process.run(["osascript", "-e", `set the clipboard to "${escaped}"`], { nothrow: true })
      }
    }

    if (os === "linux") {
      if (process.env["WAYLAND_DISPLAY"] && which("wl-copy")) {
        console.log("clipboard: using wl-copy")
        return async (text: string) => {
          const proc = Process.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
          if (!proc.stdin) return
          proc.stdin.write(text)
          proc.stdin.end()
          await proc.exited.catch(() => {})
        }
      }
      if (which("xclip")) {
        console.log("clipboard: using xclip")
        return async (text: string) => {
          const proc = Process.spawn(["xclip", "-selection", "clipboard"], {
            stdin: "pipe",
            stdout: "ignore",
            stderr: "ignore",
          })
          if (!proc.stdin) return
          proc.stdin.write(text)
          proc.stdin.end()
          await proc.exited.catch(() => {})
        }
      }
      if (which("xsel")) {
        console.log("clipboard: using xsel")
        return async (text: string) => {
          const proc = Process.spawn(["xsel", "--clipboard", "--input"], {
            stdin: "pipe",
            stdout: "ignore",
            stderr: "ignore",
          })
          if (!proc.stdin) return
          proc.stdin.write(text)
          proc.stdin.end()
          await proc.exited.catch(() => {})
        }
      }
    }

    if (os === "win32") {
      console.log("clipboard: using powershell")
      return async (text: string) => {
        // Pipe via stdin to avoid PowerShell string interpolation ($env:FOO, $(), etc.)
        const proc = Process.spawn(
          [
            "powershell.exe",
            "-NonInteractive",
            "-NoProfile",
            "-Command",
            "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
          ],
          {
            stdin: "pipe",
            stdout: "ignore",
            stderr: "ignore",
          },
        )

        if (!proc.stdin) return
        proc.stdin.write(text)
        proc.stdin.end()
        await proc.exited.catch(() => {})
      }
    }

    console.log("clipboard: no native support")
    return async (text: string) => {
      await clipboardy.write(text).catch(() => {})
    }
  })

  /**
   * Copies text to the system clipboard.
   *
   * First writes the text using OSC 52 escape sequence for SSH compatibility,
   * then uses the platform-specific method (osascript on macOS, wl-copy/xclip/xsel
   * on Linux, PowerShell on Windows, or clipboardy as fallback).
   *
   * @param text - The text to copy to the clipboard
   * @returns A promise that resolves when the copy is complete
   */
  export async function copy(text: string): Promise<void> {
    writeOsc52(text)
    await getCopyMethod()(text)
  }
}
