import { execFile, spawn } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import { platform, release, tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

function command(command: string, args: string[] = [], input?: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"] })
    const output: Buffer[] = []
    child.on("error", reject)
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk))
    child.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(output))
      reject(new Error(`${command} exited with code ${code}`))
    })
    if (input !== undefined) child.stdin?.end(input)
  })
}

function writeOsc52(text: string) {
  if (!process.stdout.isTTY) return
  const sequence = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`
  process.stdout.write(process.env.TMUX || process.env.STY ? `\x1bPtmux;\x1b${sequence}\x1b\\` : sequence)
}

export async function read() {
  if (platform() === "darwin") {
    const file = path.join(tmpdir(), "opencode-clipboard.png")
    try {
      await exec("osascript", [
        "-e",
        'set imageData to the clipboard as "PNGf"',
        "-e",
        `set fileRef to open for access POSIX file "${file}" with write permission`,
        "-e",
        "set eof fileRef to 0",
        "-e",
        "write imageData to fileRef",
        "-e",
        "close access fileRef",
      ])
      return { data: (await readFile(file)).toString("base64"), mime: "image/png" }
    } catch {
      // Fall through to text clipboard.
    } finally {
      await rm(file, { force: true }).catch(() => {})
    }
  }

  if (platform() === "win32" || release().includes("WSL")) {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }"
    const image = await command("powershell.exe", ["-NonInteractive", "-NoProfile", "-command", script]).catch(() =>
      Buffer.alloc(0),
    )
    if (image.length) return { data: image.toString().trim(), mime: "image/png" }
  }

  if (platform() === "linux") {
    const wayland = await command("wl-paste", ["-t", "image/png"]).catch(() => Buffer.alloc(0))
    if (wayland.length) return { data: wayland.toString("base64"), mime: "image/png" }
    const x11 = await command("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]).catch(() =>
      Buffer.alloc(0),
    )
    if (x11.length) return { data: x11.toString("base64"), mime: "image/png" }
  }

  // Windows: try Win32 API first (works in admin/elevated terminals), then PowerShell, then clipboardy
  if (platform() === "win32" || release().includes("WSL")) {
    // Win32 API fallback - works in all terminal privilege levels
    try {
      const { dlopen, ptr, CStr } = await import("bun:ffi")
      const user32 = dlopen("user32.dll", {
        OpenClipboard: { args: ["u32"], returns: "ptr" },
        CloseClipboard: { args: [], returns: "i32" },
        GetClipboardData: { args: ["u32"], returns: "ptr" },
        GlobalLock: { args: ["ptr"], returns: "ptr" },
        GlobalUnlock: { args: ["ptr"], returns: "i32" },
        GlobalSize: { args: ["ptr"], returns: "usize" },
      })
      if (user32.symbols.OpenClipboard(0)) {
        try {
          const hData = user32.symbols.GetClipboardData(1) // CF_UNICODETEXT = 1
          if (hData) {
            const pStr = user32.symbols.GlobalLock(hData)
            if (pStr) {
              try {
                const size = user32.symbols.GlobalSize(hData)
                const bytes = new Uint8Array(Number(size))
                const view = new Uint8Array(bytes.buffer)
                const src = new Uint8Array(
                  (globalThis as any).__memory.slice(pStr, Number(size)),
                )
                view.set(src)
                // Read as null-terminated UTF-16LE string
                const decoder = new TextDecoder("utf-16le")
                const raw = decoder.decode(view)
                const result = raw.replace(/\0+$/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                if (result) return { data: result, mime: "text/plain" }
              } finally {
                user32.symbols.GlobalUnlock(hData)
              }
            }
          }
        } finally {
          user32.symbols.CloseClipboard()
        }
      }
    } catch {
      // Win32 FFI not available (non-Bun runtime), fall through
    }

    // PowerShell fallback
    const text = await command("powershell.exe", [
      "-NonInteractive",
      "-NoProfile",
      "-command",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard",
    ]).catch(() => Buffer.alloc(0))
    const result = text.toString("utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd()
    if (result) return { data: result, mime: "text/plain" }
  }

  const { default: clipboardy } = await import("clipboardy")
  const text = await clipboardy.read().catch(() => undefined)
  if (text) return { data: text, mime: "text/plain" }
}

export function copyCommand(
  os: NodeJS.Platform,
  wayland: boolean,
  has: (name: string) => boolean,
): string[] | undefined {
  if (os === "darwin" && has("osascript")) return ["osascript"]
  if (os === "linux" && wayland && has("wl-copy")) return ["wl-copy"]
  if (os === "linux" && has("xclip")) return ["xclip", "-selection", "clipboard"]
  if (os === "linux" && has("xsel")) return ["xsel", "--clipboard", "--input"]
  if (os === "win32" && has("powershell.exe")) {
    return [
      "powershell.exe",
      "-NonInteractive",
      "-NoProfile",
      "-Command",
      "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
    ]
  }
}

let copyMethod: Promise<(text: string) => Promise<void>> | undefined

function getCopyMethod() {
  return (copyMethod ??= (async () => {
    const { which } = await import("@opencode-ai/core/util/which")
    const native = copyCommand(platform(), Boolean(process.env.WAYLAND_DISPLAY), (name) => Boolean(which(name)))
    if (native?.[0] === "osascript") {
      return async (text: string) => {
        const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        await command("osascript", ["-e", `set the clipboard to "${escaped}"`]).catch(() => undefined)
      }
    }
    if (native) {
      return async (text: string) => {
        await command(native[0], native.slice(1), text).catch(() => undefined)
      }
    }
    return async (text: string) => {
      const { default: clipboardy } = await import("clipboardy")
      await clipboardy.write(text).catch(() => undefined)
    }
  })())
}

export async function write(text: string) {
  writeOsc52(text)
  const method = await getCopyMethod()
  await method(text)
}
