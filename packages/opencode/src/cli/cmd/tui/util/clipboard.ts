import { spawn, execSync } from "node:child_process"
import { platform, release } from "os"
import clipboardy from "clipboardy"
import { lazy } from "../../../../util/lazy.js"
import { tmpdir } from "os"
import path from "path"

function runCommand(cmd: string, args: string[]): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] })
    const chunks: Buffer[] = []
    proc.stdout.on("data", (chunk) => chunks.push(chunk))
    proc.on("close", (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks))
      } else {
        resolve(undefined)
      }
    })
    proc.on("error", () => resolve(undefined))
  })
}

function runCommandText(cmd: string, args: string[]): Promise<string | undefined> {
  return runCommand(cmd, args).then((buf) => buf?.toString("utf-8"))
}

function writeToCommand(cmd: string, args: string[], data: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] })
    proc.stdin.write(data)
    proc.stdin.end()
    proc.on("close", () => resolve())
    proc.on("error", () => resolve())
  })
}

function execQuiet(cmd: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn("sh", ["-c", cmd], { stdio: "ignore" })
    proc.on("close", () => resolve())
    proc.on("error", () => resolve())
  })
}

function which(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" })
    return true
  } catch {
    return false
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
        await execQuiet(
          `osascript -e 'set imageData to the clipboard as "PNGf"' -e 'set fileRef to open for access POSIX file "${tmpfile}" with write permission' -e 'set eof fileRef to 0' -e 'write imageData to fileRef' -e 'close access fileRef'`,
        )
        const file = Bun.file(tmpfile)
        if (await file.exists()) {
          const buffer = await file.arrayBuffer()
          if (buffer.byteLength > 0) {
            return { data: Buffer.from(buffer).toString("base64"), mime: "image/png" }
          }
        }
      } catch {
      } finally {
        await execQuiet(`rm -f "${tmpfile}"`)
      }
    }

    if (os === "win32" || release().includes("WSL")) {
      const script =
        "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }"
      const result = await runCommandText("powershell.exe", ["-NonInteractive", "-NoProfile", "-command", script])
      if (result) {
        const imageBuffer = Buffer.from(result.trim(), "base64")
        if (imageBuffer.length > 0) {
          return { data: imageBuffer.toString("base64"), mime: "image/png" }
        }
      }
    }

    if (os === "linux") {
      const wayland = await runCommand("wl-paste", ["-t", "image/png"])
      if (wayland && wayland.byteLength > 0) {
        return { data: wayland.toString("base64"), mime: "image/png" }
      }
      const x11 = await runCommand("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"])
      if (x11 && x11.byteLength > 0) {
        return { data: x11.toString("base64"), mime: "image/png" }
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
        await execQuiet(`osascript -e 'set the clipboard to "${escaped}"'`)
      }
    }

    if (os === "linux") {
      if (process.env["WAYLAND_DISPLAY"] && which("wl-copy")) {
        console.log("clipboard: using wl-copy")
        return async (text: string) => {
          await writeToCommand("wl-copy", [], text)
        }
      }
      if (which("xclip")) {
        console.log("clipboard: using xclip")
        return async (text: string) => {
          await writeToCommand("xclip", ["-selection", "clipboard"], text)
        }
      }
      if (which("xsel")) {
        console.log("clipboard: using xsel")
        return async (text: string) => {
          await writeToCommand("xsel", ["--clipboard", "--input"], text)
        }
      }
    }

    if (os === "win32") {
      console.log("clipboard: using powershell")
      return async (text: string) => {
        const escaped = text.replace(/"/g, '""').replace(/`/g, "``")
        await execQuiet(`powershell -NonInteractive -NoProfile -Command "Set-Clipboard -Value \\"${escaped}\\""`)
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
