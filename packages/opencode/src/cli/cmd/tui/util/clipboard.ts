import { $ } from "bun"
import { platform, release } from "os"
import clipboardy from "clipboardy"
import { lazy } from "../../../../util/lazy.js"
import { tmpdir } from "os"
import path from "path"
import { createHash } from "crypto"
import { Log } from "@/util/log"

const log = Log.create({ service: "tui.clipboard" })

/**
 * Writes text to clipboard via OSC 52 escape sequence.
 * This allows clipboard operations to work over SSH by having
 * the terminal emulator handle the clipboard locally.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) {
    log.debug("osc52.skip", { reason: "stdout_not_tty" })
    return
  }

  const base64 = Buffer.from(text).toString("base64")
  const osc52 = `\x1b]52;c;${base64}\x07`
  // tmux and screen require DCS passthrough wrapping
  const passthrough = process.env["TMUX"] || process.env["STY"]
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
  try {
    process.stdout.write(sequence)
    log.debug("osc52.write", {
      passthrough: Boolean(passthrough),
      bytes: sequence.length,
    })
  } catch (error) {
    log.warn("osc52.write_failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export namespace Clipboard {
  export interface Content {
    data: string
    mime: string
  }

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

    const env = {
      DISPLAY: process.env["DISPLAY"],
      WAYLAND_DISPLAY: process.env["WAYLAND_DISPLAY"],
      TMUX: Boolean(process.env["TMUX"]),
      STY: Boolean(process.env["STY"]),
    }

    if (os === "darwin" && Bun.which("osascript")) {
      log.info("copy_method.selected", { method: "osascript", ...env })
      return {
        name: "osascript",
        copy: async (text: string) => {
        const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        await $`osascript -e 'set the clipboard to "${escaped}"'`.nothrow().quiet()
        },
      }
    }

    if (os === "linux") {
      if (process.env["WAYLAND_DISPLAY"] && Bun.which("wl-copy")) {
        log.info("copy_method.selected", { method: "wl-copy", ...env })
        return {
          name: "wl-copy",
          copy: async (text: string) => {
            const proc = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
            proc.stdin.write(text)
            proc.stdin.end()
            const exitCode = await proc.exited.catch((error) => {
              const msg = error instanceof Error ? error.message : String(error)
              log.error("copy_method.failed", {
                method: "wl-copy",
                error: msg,
              })
              throw new Error(`wl-copy failed: ${msg}`)
            })
            if (exitCode !== 0) {
              log.error("copy_method.nonzero_exit", { method: "wl-copy", exitCode })
              throw new Error(`wl-copy exited with code ${exitCode}`)
            }
          },
        }
      }
      if (Bun.which("xclip")) {
        log.info("copy_method.selected", { method: "xclip", ...env })
        return {
          name: "xclip",
          copy: async (text: string) => {
            const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
              stdin: "pipe",
              stdout: "ignore",
              stderr: "ignore",
            })
            proc.stdin.write(text)
            proc.stdin.end()
            const exitCode = await proc.exited.catch((error) => {
              const msg = error instanceof Error ? error.message : String(error)
              log.error("copy_method.failed", {
                method: "xclip",
                error: msg,
              })
              throw new Error(`xclip failed: ${msg}`)
            })
            if (exitCode !== 0) {
              log.error("copy_method.nonzero_exit", { method: "xclip", exitCode })
              throw new Error(`xclip exited with code ${exitCode}`)
            }
          },
        }
      }
      if (Bun.which("xsel")) {
        log.info("copy_method.selected", { method: "xsel", ...env })
        return {
          name: "xsel",
          copy: async (text: string) => {
            const proc = Bun.spawn(["xsel", "--clipboard", "--input"], {
              stdin: "pipe",
              stdout: "ignore",
              stderr: "ignore",
            })
            proc.stdin.write(text)
            proc.stdin.end()
            const exitCode = await proc.exited.catch((error) => {
              const msg = error instanceof Error ? error.message : String(error)
              log.error("copy_method.failed", {
                method: "xsel",
                error: msg,
              })
              throw new Error(`xsel failed: ${msg}`)
            })
            if (exitCode !== 0) {
              log.error("copy_method.nonzero_exit", { method: "xsel", exitCode })
              throw new Error(`xsel exited with code ${exitCode}`)
            }
          },
        }
      }
    }

    if (os === "win32") {
      log.info("copy_method.selected", { method: "powershell", ...env })
      return {
        name: "powershell",
        copy: async (text: string) => {
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
        const exitCode = await proc.exited.catch((error) => {
          const msg = error instanceof Error ? error.message : String(error)
          log.error("copy_method.failed", {
            method: "powershell",
            error: msg,
          })
          throw new Error(`PowerShell copy failed: ${msg}`)
        })
        if (exitCode !== 0) {
          log.error("copy_method.nonzero_exit", { method: "powershell", exitCode })
          throw new Error(`PowerShell copy exited with code ${exitCode}`)
        }
        },
      }
    }

    log.info("copy_method.selected", { method: "clipboardy", ...env })
    return {
      name: "clipboardy",
      copy: async (text: string) => {
        await clipboardy.write(text).catch((error) => {
          const msg = error instanceof Error ? error.message : String(error)
          log.error("copy_method.failed", {
            method: "clipboardy",
            error: msg,
          })
          throw new Error(msg)
        })
      },
    }
  })

  export async function copy(text: string): Promise<void> {
    const digest = createHash("sha256").update(text).digest("hex").slice(0, 12)
    const method = getCopyMethod()
    log.debug("copy.request", {
      method: method.name,
      tty: Boolean(process.stdout.isTTY),
      length: text.length,
      sha256_12: digest,
      DISPLAY: process.env["DISPLAY"],
      WAYLAND_DISPLAY: process.env["WAYLAND_DISPLAY"],
    })

    writeOsc52(text)
    await method.copy(text)
  }
}
