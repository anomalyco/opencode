import { execSync, spawn } from "node:child_process"
import { readFile, rm, writeFile } from "node:fs/promises"
import { platform, release, tmpdir } from "node:os"
import path from "node:path"

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
      execSync(
        `osascript -e 'set imageData to the clipboard as "PNGf"' -e 'set fileRef to open for access POSIX file "${file}" with write permission' -e 'set eof fileRef to 0' -e 'write imageData to fileRef' -e 'close access fileRef'`,
        { stdio: "ignore" },
      )
      return { data: (await readFile(file)).toString("base64"), mime: "image/png" }
    } catch {
      // Fall through to text clipboard.
    } finally {
      await rm(file, { force: true }).catch(() => {})
    }
  }

  if (platform() === "win32" || release().includes("WSL")) {
    try {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$d = [System.Windows.Forms.Clipboard]::GetDataObject()",
        "if ($d) {",
        "  if ($d.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {",
        "    $files = $d.GetData([System.Windows.Forms.DataFormats]::FileDrop)",
        "    foreach ($f in $files) {",
        "      if (Test-Path $f) {",
        "        $bytes = [System.IO.File]::ReadAllBytes($f)",
        "        $b64 = [System.Convert]::ToBase64String($bytes)",
        "        $ext = [System.IO.Path]::GetExtension($f).ToLower()",
        "        $mime = switch ($ext) { '.png' {'image/png'} '.jpg' {'image/jpeg'} '.jpeg' {'image/jpeg'} '.gif' {'image/gif'} '.webp' {'image/webp'} '.bmp' {'image/bmp'} default {'application/octet-stream'} }",
        "        Write-Host \"FILEDATA:$mime`:$b64\"",
        "        break",
        "      }",
        "    }",
        "  } elseif ($d.GetDataPresent([System.Windows.Forms.DataFormats]::Bitmap)) {",
        "    $img = $d.GetData([System.Windows.Forms.DataFormats]::Bitmap)",
        "    $ms = New-Object System.IO.MemoryStream",
        "    $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
        "    Write-Host \"FILEDATA:image/png:$([System.Convert]::ToBase64String($ms.ToArray()))\"",
        "  }",
        "}",
      ].join("; ")
      const stdout = execSync(`powershell.exe -STA -NonInteractive -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      })
      const match = stdout.match(/FILEDATA:([^:]+):(.+)/)
      if (match) {
        const mime = match[1]
        const data = match[2].trim()
        if (mime.startsWith("image/") && data.length > 0) {
          return { data, mime }
        }
      }
    } catch {
      // Fall through to text clipboard.
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
