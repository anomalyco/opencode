import { spawn } from "node:child_process"
import { openSync, writeSync, closeSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { platform, release, tmpdir } from "node:os"
import path from "node:path"

// Clipboard backend selection is modeled after codex's clipboard_copy.rs:
//
// 1. SSH session: terminal-mediated copy only (tmux native integration or
//    OSC 52), because a native clipboard on the remote machine is useless.
// 2. Local session: native clipboard first. On Linux this is a pure-JS X11
//    selection owner (see ./x11) which needs no external binaries and works
//    on Wayland via XWayland. External tools (wl-copy/xclip/xsel) are used
//    only as an opportunistic extra. OSC 52 is the last resort.
// 3. Every backend failure is collected; if all fail the error is thrown so
//    the UI can tell the user instead of silently showing a success toast.

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

/// Maximum raw bytes base64-encoded into an OSC 52 sequence (same cap as codex).
const OSC52_MAX_RAW_BYTES = 100_000

function osc52Sequence(text: string) {
  const raw = Buffer.from(text, "utf8")
  if (raw.length > OSC52_MAX_RAW_BYTES) {
    throw new Error(`OSC 52 payload too large (${raw.length} bytes; max ${OSC52_MAX_RAW_BYTES})`)
  }
  const sequence = `\x1b]52;c;${raw.toString("base64")}\x07`
  return process.env.TMUX ? `\x1bPtmux;\x1b${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\` : sequence
}

async function osc52Copy(text: string) {
  const sequence = osc52Sequence(text)
  if (process.env.STY && !process.env.TMUX) {
    // GNU screen passthrough
    const wrapped = `\x1bP\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07\x1b\\`
    write(wrapped)
    return
  }
  write(sequence)

  function write(data: string) {
    if (process.stdout.isTTY) {
      process.stdout.write(data)
      return
    }
    // Like codex: write to the controlling terminal when stdout is redirected
    const fd = openSync("/dev/tty", "w")
    try {
      writeSync(fd, data)
    } finally {
      closeSync(fd)
    }
  }
}

async function tmuxCopy(text: string) {
  const setClipboard = await command("tmux", ["show-options", "-gv", "set-clipboard"]).then(
    (out) => out.toString().trim(),
    () => "",
  )
  if (setClipboard === "off") throw new Error("tmux clipboard forwarding is disabled (set-clipboard off)")
  await command("tmux", ["load-buffer", "-w", "-"], text)
}

const isSsh = () => Boolean(process.env.SSH_TTY || process.env.SSH_CONNECTION)
const isTmux = () => Boolean(process.env.TMUX || process.env.TMUX_PANE)
const isWsl = () => platform() === "linux" && release().includes("WSL")

// Linux native clipboard: a long-lived pure-JS X11 selection owner.
// Kept alive for the TUI lifetime so the copied text remains pasteable
// (same ownership semantics as codex's ClipboardLease).
let owner: Promise<import("./clipboard/x11").X11Clipboard> | undefined
function x11Owner() {
  return (owner ??= import("./clipboard/x11").then(({ X11Clipboard }) => X11Clipboard.create())).catch((error) => {
    // Do not cache a failed connection: the X server may become available later
    owner = undefined
    throw error
  })
}

async function powershellCopy(text: string) {
  await command("powershell.exe", [
    "-NonInteractive",
    "-NoProfile",
    "-Command",
    "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; $text = [Console]::In.ReadToEnd(); Set-Clipboard -Value $text",
  ], text)
}

export type Backend =
  | "tmux"
  | "osc52"
  | "x11"
  | "wl-copy"
  | "xclip"
  | "xsel"
  | "osascript"
  | "powershell"

export function plan(opts: {
  os: NodeJS.Platform
  ssh: boolean
  tmux: boolean
  wsl: boolean
  display: boolean
  has: (name: string) => boolean
}): Backend[] {
  if (opts.ssh) return opts.tmux ? ["tmux", "osc52"] : ["osc52"]
  if (opts.os === "darwin") return ["osascript"]
  if (opts.os === "win32" || opts.wsl) return ["powershell", ...(opts.tmux ? (["tmux"] as const) : []), "osc52"]
  if (opts.os === "linux") {
    const backends: Backend[] = []
    if (opts.display) backends.push("x11")
    if (opts.has("wl-copy")) backends.push("wl-copy")
    if (opts.has("xclip")) backends.push("xclip")
    if (opts.has("xsel")) backends.push("xsel")
    if (opts.tmux) backends.push("tmux")
    backends.push("osc52")
    return backends
  }
  return ["osc52"]
}

async function run(name: Backend, text: string): Promise<void> {
  switch (name) {
    case "tmux":
      return tmuxCopy(text)
    case "osc52":
      return osc52Copy(text)
    case "x11":
      return x11Owner().then((clipboard) => clipboard.setText(text))
    case "wl-copy":
      return command("wl-copy", [], text).then(() => undefined)
    case "xclip":
      return command("xclip", ["-selection", "clipboard"], text).then(() => undefined)
    case "xsel":
      return command("xsel", ["--clipboard", "--input"], text).then(() => undefined)
    case "osascript": {
      const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      return command("osascript", ["-e", `set the clipboard to "${escaped}"`]).then(() => undefined)
    }
    case "powershell":
      return powershellCopy(text)
  }
}

export async function write(text: string) {
  const { which } = await import("@opencode-ai/core/util/which")
  const backends = plan({
    os: platform(),
    ssh: isSsh(),
    tmux: isTmux(),
    wsl: isWsl(),
    display: Boolean(process.env.DISPLAY),
    has: (name) => Boolean(which(name)),
  })
  const errors: string[] = []
  for (const backend of backends) {
    try {
      await run(backend, text)
      return
    } catch (error) {
      errors.push(`${backend}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`failed to copy to clipboard — ${errors.join("; ")}`)
}

export async function read() {
  if (platform() === "darwin") {
    const file = path.join(tmpdir(), "opencode-clipboard.png")
    try {
      await command("osascript", [
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
      await rm(file, { force: true }).catch(() => undefined)
    }
  }

  if (platform() === "win32" || isWsl()) {
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

    // Pure-JS fallback: read the X11 selection (via XWayland on Wayland)
    // without relying on clipboardy's bundled xsel binary, which does not
    // survive bundling into the compiled binary.
    const text = await x11Owner()
      .then((clipboard) => clipboard.readText())
      .catch(() => undefined)
    if (text) return { data: text, mime: "text/plain" }
  }

  const { default: clipboardy } = await import("clipboardy")
  const text = await clipboardy.read().catch(() => undefined)
  if (text) return { data: text, mime: "text/plain" }
}
