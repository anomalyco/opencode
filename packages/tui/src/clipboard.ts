import { execFile, spawn } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import { platform, release, tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

export type ClipboardWriteMethod = "osascript" | "wl-copy" | "xclip" | "xsel" | "powershell" | "clipboardy" | "osc52"
export type ClipboardWriteResult = Readonly<{
  method: ClipboardWriteMethod
  verified: boolean
}>
export type ClipboardWriteAttempt = Readonly<{ method: ClipboardWriteMethod; error: string }>
export class ClipboardWriteError extends Error {
  constructor(readonly attempts: ClipboardWriteAttempt[]) {
    super(`Clipboard write failed: ${attempts.map((attempt) => `${attempt.method}: ${attempt.error}`).join("; ")}`)
    this.name = "ClipboardWriteError"
  }
}

type ClipboardCommand = Readonly<{
  method: Exclude<ClipboardWriteMethod, "clipboardy" | "osc52">
  command: string
  args: string[]
}>
export type ClipboardCandidate = ClipboardCommand | Readonly<{ method: "clipboardy" }> | Readonly<{ method: "osc52" }>

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

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function debug(message: string) {
  if (process.env.OPENCODE_CLIPBOARD_DEBUG !== "1") return
  process.stderr.write(`[opencode clipboard] ${message}\n`)
}

function writeOsc52(text: string, stdout: Pick<NodeJS.WriteStream, "isTTY" | "write"> = process.stdout) {
  if (!stdout.isTTY) throw new Error("stdout is not a TTY")
  const sequence = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`
  stdout.write(process.env.TMUX || process.env.STY ? `\x1bPtmux;\x1b${sequence}\x1b\\` : sequence)
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

export function clipboardCandidates(
  os: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  has: (name: string) => boolean,
): ClipboardCandidate[] {
  const result: ClipboardCandidate[] = []

  if (os === "darwin" && has("osascript")) {
    result.push({ method: "osascript", command: "osascript", args: [] })
  }

  if (os === "linux") {
    if (env.WAYLAND_DISPLAY && has("wl-copy")) result.push({ method: "wl-copy", command: "wl-copy", args: [] })
    if (env.DISPLAY && has("xclip")) {
      result.push({ method: "xclip", command: "xclip", args: ["-selection", "clipboard"] })
    }
    if (env.DISPLAY && has("xsel")) result.push({ method: "xsel", command: "xsel", args: ["--clipboard", "--input"] })
  }

  if ((os === "win32" || release().includes("WSL")) && has("powershell.exe")) {
    result.push({
      method: "powershell",
      command: "powershell.exe",
      args: [
        "-NonInteractive",
        "-NoProfile",
        "-Command",
        "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
      ],
    })
  }

  result.push({ method: "clipboardy" })
  result.push({ method: "osc52" })
  return result
}

export async function writeWithCandidates(
  text: string,
  candidates: ClipboardCandidate[],
  run: (candidate: ClipboardCandidate, text: string) => Promise<ClipboardWriteResult>,
) {
  const attempts: ClipboardWriteAttempt[] = []
  for (const candidate of candidates) {
    try {
      const result = await run(candidate, text)
      debug(`wrote using ${result.method}${result.verified ? "" : " (unverified)"}`)
      return result
    } catch (err) {
      const error = errorMessage(err)
      debug(`${candidate.method} failed: ${error}`)
      attempts.push({ method: candidate.method, error })
    }
  }
  throw new ClipboardWriteError(attempts)
}

async function runCandidate(candidate: ClipboardCandidate, text: string): Promise<ClipboardWriteResult> {
  if (candidate.method === "clipboardy") {
    const { default: clipboardy } = await import("clipboardy")
    await clipboardy.write(text)
    return { method: "clipboardy", verified: true }
  }

  if (candidate.method === "osc52") {
    writeOsc52(text)
    return { method: "osc52", verified: false }
  }

  if (candidate.method === "osascript") {
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    await command("osascript", ["-e", `set the clipboard to "${escaped}"`])
    return { method: "osascript", verified: true }
  }

  await command(candidate.command, candidate.args, text)
  return { method: candidate.method, verified: true }
}

export async function write(text: string): Promise<ClipboardWriteResult> {
  const mode = process.env.OPENCODE_CLIPBOARD ?? "auto"
  if (mode === "off") throw new ClipboardWriteError([{ method: "clipboardy", error: "clipboard disabled" }])

  const { which } = await import("@opencode-ai/core/util/which")
  const candidates = clipboardCandidates(platform(), process.env, (name) => Boolean(which(name))).filter((candidate) => {
    if (mode === "native") return candidate.method !== "osc52"
    if (mode === "osc52") return candidate.method === "osc52"
    return true
  })
  return writeWithCandidates(text, candidates, runCandidate)
}
