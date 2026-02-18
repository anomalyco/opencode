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
  const passthrough = process.env["TMUX"] || process.env["STY"]
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
  process.stdout.write(sequence)
}

type CopyMethod = {
  name: string
  copy: (text: string) => Promise<void>
}

async function spawnCopy(name: string, cmd: string[], text: string): Promise<void> {
  const proc = Bun.spawn(cmd, {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  })
  proc.stdin.write(text)
  proc.stdin.end()

  const err = proc.stderr ? await new Response(proc.stderr).text().catch(() => "") : ""
  const code = await proc.exited
  if (code === 0) return
  throw new Error(`${name} exited with code ${code}${err ? `: ${err.trim()}` : ""}`)
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

  const getCopyMethods = lazy(() => {
    const os = platform()
    const list: CopyMethod[] = []

    if (os === "darwin" && Bun.which("osascript")) {
      console.log("clipboard: enabled osascript")
      list.push({
        name: "osascript",
        copy: async (text: string) => {
          const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
          const result = await $`osascript -e 'set the clipboard to "${escaped}"'`.nothrow().quiet()
          if (result.exitCode === 0) return
          throw new Error("osascript failed")
        },
      })
    }

    if (os === "linux") {
      const wsl = release().includes("WSL")
      if (wsl && Bun.which("clip.exe")) {
        console.log("clipboard: enabled clip.exe")
        list.push({
          name: "clip.exe",
          copy: (text: string) => spawnCopy("clip.exe", ["clip.exe"], text),
        })
      }
      if (process.env["WAYLAND_DISPLAY"] && Bun.which("wl-copy")) {
        console.log("clipboard: enabled wl-copy")
        list.push({
          name: "wl-copy",
          copy: (text: string) => spawnCopy("wl-copy", ["wl-copy"], text),
        })
      }
      if (Bun.which("xclip")) {
        console.log("clipboard: enabled xclip")
        list.push({
          name: "xclip",
          copy: (text: string) => spawnCopy("xclip", ["xclip", "-selection", "clipboard"], text),
        })
      }
      if (Bun.which("xsel")) {
        console.log("clipboard: enabled xsel")
        list.push({
          name: "xsel",
          copy: (text: string) => spawnCopy("xsel", ["xsel", "--clipboard", "--input"], text),
        })
      }
    }

    if (os === "win32") {
      if (Bun.which("powershell.exe")) {
        console.log("clipboard: enabled powershell.exe")
        list.push({
          name: "powershell.exe",
          copy: (text: string) =>
            spawnCopy(
              "powershell.exe",
              [
                "powershell.exe",
                "-NonInteractive",
                "-NoProfile",
                "-Command",
                "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
              ],
              text,
            ),
        })
      }
      if (Bun.which("pwsh.exe")) {
        console.log("clipboard: enabled pwsh.exe")
        list.push({
          name: "pwsh.exe",
          copy: (text: string) =>
            spawnCopy(
              "pwsh.exe",
              [
                "pwsh.exe",
                "-NonInteractive",
                "-NoProfile",
                "-Command",
                "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
              ],
              text,
            ),
        })
      }
      if (Bun.which("clip.exe")) {
        console.log("clipboard: enabled clip.exe")
        list.push({
          name: "clip.exe",
          copy: (text: string) => spawnCopy("clip.exe", ["clip.exe"], text),
        })
      }
    }

    list.push({
      name: "clipboardy",
      copy: async (text: string) => {
        await clipboardy.write(text)
      },
    })

    console.log(`clipboard: enabled ${list.map((x) => x.name).join(", ")}`)
    return list
  })

  export async function copy(text: string): Promise<void> {
    writeOsc52(text)
    const os = platform()
    const list = getCopyMethods()
    const errs: string[] = []

    for (const method of list) {
      const err = await method
        .copy(text)
        .then(() => undefined)
        .catch((error) => error)
      if (!err) return
      errs.push(err instanceof Error ? `${method.name}: ${err.message}` : `${method.name}: ${String(err)}`)
    }

    const hint = (() => {
      if (os === "linux") {
        return "Install wl-clipboard, xclip, or xsel and verify DISPLAY/WAYLAND_DISPLAY is set."
      }
      if (os === "win32") {
        return "Ensure clip.exe or PowerShell is available and the terminal session can access the Windows clipboard."
      }
      return ""
    })()

    throw new Error(`Failed to copy to clipboard. ${hint} Tried: ${errs.join(" | ")}`.trim())
  }
}
