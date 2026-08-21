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

export type ClipboardSelection = "clipboard" | "primary" | "both"
export type ClipboardBuffer = Exclude<ClipboardSelection, "both">

export async function read(selection: ClipboardBuffer = "clipboard") {
  const primary = selection === "primary"

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
    const waylandImage = await command("wl-paste", primary ? ["-p", "-t", "image/png"] : ["-t", "image/png"]).catch(
      () => Buffer.alloc(0),
    )
    if (waylandImage.length) return { data: waylandImage.toString("base64"), mime: "image/png" }
    const x11Image = await command("xclip", [
      "-selection",
      primary ? "primary" : "clipboard",
      "-t",
      "image/png",
      "-o",
    ]).catch(() => Buffer.alloc(0))
    if (x11Image.length) return { data: x11Image.toString("base64"), mime: "image/png" }
    if (primary) {
      const waylandText = await command("wl-paste", ["-p"]).catch(() => Buffer.alloc(0))
      if (waylandText.length) return { data: waylandText.toString("utf8"), mime: "text/plain" }
      const x11Text = await command("xclip", ["-selection", "primary", "-o"]).catch(() => Buffer.alloc(0))
      if (x11Text.length) return { data: x11Text.toString("utf8"), mime: "text/plain" }
    }
  }

  // clipboardy only supports the clipboard; for "primary" this reads back the
  // buffer the clipboardy fallback in write() targets
  const { default: clipboardy } = await import("clipboardy")
  const text = await clipboardy.read().catch(() => undefined)
  if (text) return { data: text, mime: "text/plain" }
}

export function copyCommand(
  os: NodeJS.Platform,
  wayland: boolean,
  has: (name: string) => boolean,
  selection: ClipboardBuffer = "clipboard",
): string[] | undefined {
  if (os === "darwin" && has("osascript")) return ["osascript"]
  if (os === "linux" && wayland && has("wl-copy"))
    return selection === "primary"
      ? ["wl-copy", "-p", "--type", "text/plain;charset=utf-8"]
      : ["wl-copy", "--type", "text/plain;charset=utf-8"]
  if (os === "linux" && has("xclip")) return ["xclip", "-selection", selection]
  if (os === "linux" && has("xsel"))
    return selection === "primary" ? ["xsel", "--primary", "--input"] : ["xsel", "--clipboard", "--input"]
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

let copyMethod: Promise<(text: string, selection?: ClipboardSelection) => Promise<void>> | undefined

function getCopyMethod() {
  return (copyMethod ??= (async () => {
    const { which } = await import("@opencode-ai/core/util/which")
    const os = platform()
    const wayland = Boolean(process.env.WAYLAND_DISPLAY)
    const has = (name: string) => Boolean(which(name))

    const clipboardCmd = copyCommand(os, wayland, has, "clipboard")
    const primaryCmd = copyCommand(os, wayland, has, "primary")
    const native = clipboardCmd
    // platforms without a primary buffer resolve both selections to the same
    // command, so it must not be spawned twice for "both"
    const distinctPrimary =
      Boolean(primaryCmd && clipboardCmd) && JSON.stringify(primaryCmd) !== JSON.stringify(clipboardCmd)

    if (native?.[0] === "osascript") {
      return async (text: string, selection?: ClipboardSelection) => {
        const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        await command("osascript", ["-e", `set the clipboard to "${escaped}"`]).catch(() => undefined)
      }
    }
    if (native) {
      return async (text: string, selection?: ClipboardSelection) => {
        if (selection === "both" && distinctPrimary && primaryCmd) {
          await Promise.allSettled([
            command(native[0], native.slice(1), text),
            command(primaryCmd[0], primaryCmd.slice(1), text),
          ])
        } else if (selection === "primary" && primaryCmd) {
          await command(primaryCmd[0], primaryCmd.slice(1), text).catch(() => undefined)
        } else {
          await command(native[0], native.slice(1), text).catch(() => undefined)
        }
      }
    }
    return async (text: string, selection?: ClipboardSelection) => {
      const { default: clipboardy } = await import("clipboardy")
      // clipboardy only supports the clipboard; "primary" falls back to it
      await clipboardy.write(text).catch(() => undefined)
    }
  })())
}

export async function write(text: string, selection?: ClipboardSelection) {
  if (selection !== "primary") {
    writeOsc52(text)
  }
  const method = await getCopyMethod()
  await method(text, selection)
}
