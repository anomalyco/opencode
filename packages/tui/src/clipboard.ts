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
  const passthrough = `\x1bPtmux;\x1b${sequence}\x1b\\`
  process.stdout.write(process.env.TMUX ? sequence + passthrough : process.env.STY ? passthrough : sequence)
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
    // GetImage()/ContainsImage() return null/false for FileDrop clipboard content
    // (images copied via Win+Shift+S → Ctrl+C or most Windows screenshot tools).
    // Probe GetDataObject() first: FileDrop yields a file path we can read directly;
    // fall back to Bitmap format for raw in-memory images (e.g. Ctrl+C in Paint).
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$obj = [System.Windows.Forms.Clipboard]::GetDataObject()",
      "if ($obj -and $obj.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {",
      "  $files = $obj.GetData([System.Windows.Forms.DataFormats]::FileDrop)",
      "  if ($files -and $files.Length -gt 0) { $files[0] }",
      "} elseif ($obj -and $obj.GetDataPresent([System.Windows.Forms.DataFormats]::Bitmap)) {",
      "  $img = [System.Windows.Forms.Clipboard]::GetImage()",
      "  if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); 'data:image/png;base64,' + [System.Convert]::ToBase64String($ms.ToArray()) }",
      "}",
    ].join("; ")
    const result = await command("powershell.exe", ["-NonInteractive", "-NoProfile", "-command", script]).catch(() =>
      Buffer.alloc(0),
    )
    const output = result.toString("utf8").trim()
    if (output.startsWith("data:image/png;base64,")) {
      return { data: output.slice("data:image/png;base64,".length), mime: "image/png" }
    }
    if (
      output.length > 0 &&
      !output.includes(" ") &&
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(output)
    ) {
      try {
        const fileData = await readFile(output)
        return { data: fileData.toString("base64"), mime: `image/${path.extname(output).slice(1).toLowerCase()}` }
      } catch {}
    }
  }

  if (platform() === "linux") {
    const wayland = await command("wl-paste", ["-t", "image/png"]).catch(() => Buffer.alloc(0))
    if (wayland.length) return { data: wayland.toString("base64"), mime: "image/png" }
    const x11 = await command("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]).catch(() =>
      Buffer.alloc(0),
    )
    if (x11.length) return { data: x11.toString("base64"), mime: "image/png" }
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
