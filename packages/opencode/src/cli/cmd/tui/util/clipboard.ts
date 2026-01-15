import { $ } from "bun"
import { platform, release } from "os"
import clipboardy from "clipboardy"
import { lazy } from "../../../../util/lazy.js"
import { tmpdir } from "os"
import path from "path"

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
      // Helper: encode PowerShell script as base64 UTF-16LE for -EncodedCommand
      // This avoids ALL quoting/escaping issues with -command "..." which breaks
      // when clipboard content ends with backslash sequences (e.g., "c:\path\file.png")
      const encodePS = (script: string) => Buffer.from(script, "utf16le").toString("base64")

      // Try to get image from Windows clipboard via PowerShell
      const imgScript = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $ms = New-Object System.IO.MemoryStream
  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [System.Convert]::ToBase64String($ms.ToArray())
}
`.trim()
      const imgEncoded = encodePS(imgScript)
      const imgOut = (await $`powershell.exe -NonInteractive -NoProfile -EncodedCommand ${imgEncoded}`.nothrow().text()).trim()
      if (imgOut) {
        try {
          const buf = Buffer.from(imgOut, "base64")
          // Validate PNG magic bytes to prevent garbage PowerShell output from being treated as image
          const isPng = buf.length >= 8 &&
            buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
            buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
          if (isPng) {
            return { data: buf.toString("base64"), mime: "image/png" }
          }
        } catch {
          // Invalid base64, fall through to text
        }
      }

      // Get TEXT from Windows clipboard via PowerShell
      // CRITICAL: On WSL2, clipboardy uses Linux clipboard tools (xclip/wl-paste) which
      // can't access Windows clipboard. We MUST use PowerShell to read Windows clipboard text.
      // Using -EncodedCommand to avoid quoting issues with trailing backslashes in clipboard content.
      const textScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { Get-Clipboard -Raw } catch { "" }
`.trim()
      const textEncoded = encodePS(textScript)
      const text = (await $`powershell.exe -NonInteractive -NoProfile -EncodedCommand ${textEncoded}`.nothrow().text())
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
      if (text && text.trim()) {
        return { data: text, mime: "text/plain" }
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
        // need to escape backticks because powershell uses them as escape code
        const escaped = text.replace(/"/g, '""').replace(/`/g, "``")
        await $`powershell -NonInteractive -NoProfile -Command "Set-Clipboard -Value \"${escaped}\""`.nothrow().quiet()
      }
    }

    console.log("clipboard: no native support")
    return async (text: string) => {
      await clipboardy.write(text).catch(() => {})
    }
  })

  export async function copy(text: string): Promise<void> {
    await getCopyMethod()(text)
  }
}
