import { $ } from "bun"
import { platform, release } from "os"
import clipboardy from "clipboardy"
import { lazy } from "../../../../util/lazy.js"
import { tmpdir } from "os"
import path from "path"

/**
 * Writes text to clipboard via OSC 52 escape sequence.
 * This allows clipboard operations to work over SSH by having
 * the terminal emulator handle the clipboard locally.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return
  const base64 = Buffer.from(text).toString("base64")
  const osc52 = `\x1b]52;c;${base64}\x07`
  // tmux and screen require DCS passthrough wrapping
  const passthrough = process.env["TMUX"] || process.env["STY"]
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
  process.stdout.write(sequence)
}

/**
 * Detect if running in a remote session (SSH, tmux, screen)
 * where rich text clipboard may not be supported
 */
function isRemoteSession(): boolean {
  return !!(process.env["SSH_CLIENT"] || process.env["SSH_TTY"] || process.env["TMUX"] || process.env["STY"])
}

/**
 * Check if a command exists in PATH
 */
function commandExists(cmd: string): boolean {
  return !!Bun.which(cmd)
}

export namespace Clipboard {
  export interface Content {
    data: string
    mime: string
  }

  export type CopyRichResult =
    | { ok: true; rich: true }
    | { ok: true; rich: false; reason: string }
    | { ok: false; error: string }

  export async function read(): Promise<Content | undefined> {
    const os = platform()

    if (os === "darwin") {
      const tmpfile = path.join(tmpdir(), "opencode-clipboard.png")
      try {
        await $`osascript -e 'set imageData to the clipboard as "PNGf"' -e 'set fileRef to open for access POSIX file "${tmpfile}" with write permission' -e 'set eof fileRef to 0' -e 'write imageData to fileRef' -e 'close access fileRef'`
          .nothrow()
          .quiet()
        const file = Bun.file(tmpfile)
        const buffer = await file.arrayBuffer()
        return { data: Buffer.from(buffer).toString("base64"), mime: "image/png" }
      } catch {
      } finally {
        await $`rm -f "${tmpfile}"`.nothrow().quiet()
      }
    }

    if (os === "win32" || release().includes("WSL")) {
      const script =
        "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }"
      const base64 = await $`powershell.exe -NonInteractive -NoProfile -command "${script}"`.nothrow().text()
      if (base64) {
        const imageBuffer = Buffer.from(base64.trim(), "base64")
        if (imageBuffer.length > 0) {
          return { data: imageBuffer.toString("base64"), mime: "image/png" }
        }
      }
    }

    if (os === "linux") {
      const wayland = await $`wl-paste -t image/png`.nothrow().arrayBuffer()
      if (wayland && wayland.byteLength > 0) {
        return { data: Buffer.from(wayland).toString("base64"), mime: "image/png" }
      }
      const x11 = await $`xclip -selection clipboard -t image/png -o`.nothrow().arrayBuffer()
      if (x11 && x11.byteLength > 0) {
        return { data: Buffer.from(x11).toString("base64"), mime: "image/png" }
      }
    }

    const text = await clipboardy.read().catch(() => {})
    if (text) {
      return { data: text, mime: "text/plain" }
    }
  }

  const getCopyMethod = lazy(() => {
    const os = platform()

    if (os === "darwin" && Bun.which("osascript")) {
      console.log("clipboard: using osascript")
      return async (text: string) => {
        const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        await $`osascript -e 'set the clipboard to "${escaped}"'`.nothrow().quiet()
      }
    }

    if (os === "linux") {
      if (process.env["WAYLAND_DISPLAY"] && Bun.which("wl-copy")) {
        console.log("clipboard: using wl-copy")
        return async (text: string) => {
          const proc = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
          proc.stdin.write(text)
          proc.stdin.end()
          await proc.exited.catch(() => {})
        }
      }
      if (Bun.which("xclip")) {
        console.log("clipboard: using xclip")
        return async (text: string) => {
          const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
            stdin: "pipe",
            stdout: "ignore",
            stderr: "ignore",
          })
          proc.stdin.write(text)
          proc.stdin.end()
          await proc.exited.catch(() => {})
        }
      }
      if (Bun.which("xsel")) {
        console.log("clipboard: using xsel")
        return async (text: string) => {
          const proc = Bun.spawn(["xsel", "--clipboard", "--input"], {
            stdin: "pipe",
            stdout: "ignore",
            stderr: "ignore",
          })
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
        const proc = Bun.spawn(
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

  export async function copy(text: string): Promise<void> {
    writeOsc52(text)
    await getCopyMethod()(text)
  }

  /**
   * Copy both plain text and HTML to clipboard (Linux Wayland)
   */
  async function copyRichWayland(plain: string, html: string): Promise<CopyRichResult> {
    if (!commandExists("wl-copy")) {
      await copy(plain)
      return { ok: true, rich: false, reason: "Install wl-clipboard for rich text support" }
    }

    try {
      const proc = Bun.spawn(["wl-copy", "--type", "text/html"], {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      })
      proc.stdin.write(html)
      proc.stdin.end()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        await copy(plain)
        return { ok: true, rich: false, reason: "wl-copy failed" }
      }

      return { ok: true, rich: true }
    } catch (error) {
      await copy(plain)
      return { ok: true, rich: false, reason: "wl-copy failed" }
    }
  }

  /**
   * Copy both plain text and HTML to clipboard (Linux X11)
   */
  async function copyRichX11(plain: string, html: string): Promise<CopyRichResult> {
    if (!commandExists("xclip")) {
      await copy(plain)
      return { ok: true, rich: false, reason: "Install xclip for rich text support" }
    }

    try {
      const proc = Bun.spawn(["xclip", "-selection", "clipboard", "-t", "text/html"], {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      })
      proc.stdin.write(html)
      proc.stdin.end()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        await copy(plain)
        return { ok: true, rich: false, reason: "xclip failed" }
      }

      return { ok: true, rich: true }
    } catch (error) {
      await copy(plain)
      return { ok: true, rich: false, reason: "xclip failed" }
    }
  }

  /**
   * Copy both plain text and HTML to clipboard (macOS)
   */
  async function copyRichMac(plain: string, html: string): Promise<CopyRichResult> {
    if (!commandExists("osascript")) {
      await copy(plain)
      return { ok: true, rich: false, reason: "osascript not found" }
    }

    try {
      // Escape special characters for AppleScript
      const escapeAppleScript = (str: string): string => {
        return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")
      }

      const escapedHtml = escapeAppleScript(html)
      const escapedPlain = escapeAppleScript(plain)

      // AppleScript to set both HTML and plain text on pasteboard
      const script = `set the clipboard to {«class HTML»:«data HTML${Buffer.from(html).toString("hex")}», string:"${escapedPlain}"}`

      const proc = Bun.spawn(["osascript", "-e", script], {
        stdout: "ignore",
        stderr: "ignore",
      })
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        await copy(plain)
        return { ok: true, rich: false, reason: "osascript failed" }
      }

      return { ok: true, rich: true }
    } catch (error) {
      await copy(plain)
      return { ok: true, rich: false, reason: "osascript failed" }
    }
  }

  /**
   * Fallback for platforms that don't support rich text
   */
  async function copyRichFallback(plain: string, reason: string): Promise<CopyRichResult> {
    await copy(plain)
    return { ok: true, rich: false, reason }
  }

  /**
   * Copy text as both plain text and rich text (HTML) to clipboard.
   * Falls back to plain text if rich text is not supported.
   */
  export async function copyRich(plain: string, html: string): Promise<CopyRichResult> {
    // Remote sessions (SSH/tmux) can't do rich text
    if (isRemoteSession()) {
      return copyRichFallback(plain, "Rich text not supported over SSH/tmux")
    }

    const os = platform()

    if (os === "darwin") {
      return copyRichMac(plain, html)
    }

    if (os === "linux") {
      if (process.env["WAYLAND_DISPLAY"]) {
        return copyRichWayland(plain, html)
      }
      return copyRichX11(plain, html)
    }

    // Windows and other platforms: plain text fallback
    return copyRichFallback(plain, "Rich text not supported on this platform")
  }
}
