/**
 * Push-to-talk voice input for the prompt composer.
 *
 * Recording uses a user-installed audio tool (ffmpeg preferred, sox `rec` as
 * fallback) so this feature adds no new native dependencies. Transcription is
 * delegated to a user-configured shell command (`tui.voice.transcribe_command`);
 * the command's stdout is inserted into the prompt at the cursor.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process"
import { existsSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

/** Holds shorter than this are treated as taps, not dictation. */
export const VOICE_MIN_HOLD_MS = 350
/** Presses closer together than this are the key repeating, not new presses. */
export const VOICE_REPEAT_GUARD_MS = 1000
/** Recordings stop automatically after this long. */
export const VOICE_MAX_RECORD_MS = 120_000
/** Placeholder replaced with the recorded wav path in the transcribe command. */
export const VOICE_FILE_PLACEHOLDER = "{file}"

export interface RecorderSpec {
  command: string
  buildArgs: (outputFile: string) => string[]
}

function commandExists(command: string): boolean {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE").split(";") : [""]
  return (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => extensions.some((extension) => existsSync(join(dir, command + extension))))
}

/** ffmpeg arguments that record the default microphone to a wav file. */
export function ffmpegArgs(platform: NodeJS.Platform, outputFile: string, audioDevice?: string): string[] {
  const input =
    platform === "darwin"
      ? ["-f", "avfoundation", "-i", ":default"]
      : platform === "win32"
        ? ["-f", "dshow", "-i", `audio=${audioDevice ?? "default"}`]
        : ["-f", "pulse", "-i", "default"]
  return ["-hide_banner", "-loglevel", "error", ...input, "-ar", "16000", "-ac", "1", "-y", outputFile]
}

/** sox `rec` arguments that record the default microphone to a wav file. */
export function soxArgs(outputFile: string): string[] {
  return ["-r", "16000", "-c", "1", outputFile]
}

function signal(proc: ChildProcess, sig: NodeJS.Signals): void {
  if (proc.exitCode === null && proc.signalCode === null) proc.kill(sig)
}

/**
 * First DirectShow audio device name, for ffmpeg's dshow on Windows.
 * dshow has no "default" alias; a concrete device name is required.
 */
export async function firstDshowAudioDevice(ffmpeg: string): Promise<string | undefined> {
  const proc = spawn(ffmpeg, ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
  const timer = setTimeout(() => signal(proc, "SIGKILL"), 5000)
  timer.unref()
  const output = await new Promise<string>((resolve) => {
    let text = ""
    proc.stderr?.on("data", (chunk: Buffer) => {
      text += chunk.toString()
    })
    proc.on("close", () => resolve(text))
    proc.on("error", () => resolve(text))
  })
  const audio = output.split("DirectShow audio devices")[1]
  return audio?.match(/"([^"]+)"/)?.[1]
}

/** Pick the best available microphone recorder, if any. */
export async function findRecorder(platform: NodeJS.Platform = process.platform): Promise<RecorderSpec | undefined> {
  if (commandExists("ffmpeg")) {
    if (platform !== "win32") return { command: "ffmpeg", buildArgs: (outputFile) => ffmpegArgs(platform, outputFile) }
    const device = await firstDshowAudioDevice("ffmpeg")
    if (device) return { command: "ffmpeg", buildArgs: (outputFile) => ffmpegArgs(platform, outputFile, device) }
  }
  if (commandExists("rec")) {
    return { command: "rec", buildArgs: (outputFile) => soxArgs(outputFile) }
  }
  return undefined
}

/**
 * Records microphone audio to a temporary wav file until stopped.
 * The recorder is terminated with SIGINT so encoders flush a valid wav
 * header; SIGKILL is only a fallback.
 */
export class VoiceRecorder {
  private proc: ChildProcess | undefined
  private file: string | undefined

  constructor(private readonly dir: string = tmpdir()) {}

  get recording(): boolean {
    return this.proc !== undefined
  }

  start(spec: RecorderSpec, onFailure?: () => void): void {
    if (this.proc) return
    const file = join(this.dir, `opencode-voice-${process.pid}-${Date.now()}.wav`)
    const proc = spawn(spec.command, spec.buildArgs(file), { stdio: "ignore" })
    const failed = () => {
      if (this.proc === proc) {
        this.proc = undefined
        this.file = undefined
        onFailure?.()
      }
    }
    proc.on("error", failed)
    // A recorder that exits on its own (missing device, bad flags) failed;
    // normal stops clear this.proc first, so they never reach here.
    proc.on("exit", failed)
    this.proc = proc
    this.file = file
  }

  /** Stop recording and resolve the wav file path, if one was produced. */
  stop(): Promise<string | undefined> {
    const proc = this.proc
    const file = this.file
    this.proc = undefined
    if (!proc || !file) {
      this.file = undefined
      return Promise.resolve(undefined)
    }
    return new Promise((resolve) => {
      const done = () => resolve(existsSync(file) ? file : undefined)
      const killTimer = setTimeout(() => signal(proc, "SIGKILL"), 3000)
      killTimer.unref()
      proc.on("exit", () => {
        clearTimeout(killTimer)
        // Give the encoder a moment to flush the wav header after SIGINT.
        const flushTimer = setTimeout(done, 150)
        flushTimer.unref()
      })
      signal(proc, "SIGINT")
      if (proc.exitCode !== null || proc.signalCode !== null) done()
    })
  }

  /** Kill the recorder (if running) and delete the temporary file. */
  dispose(): void {
    const proc = this.proc
    const file = this.file
    this.proc = undefined
    this.file = undefined
    if (proc) signal(proc, "SIGKILL")
    if (file && existsSync(file)) unlinkSync(file)
  }
}

function quoteShellArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * Build the shell command that transcribes a recording. The wav path replaces
 * every `{file}` placeholder in the template, or is appended as the last
 * argument when the template has no placeholder.
 */
export function buildTranscribeShellCommand(template: string, wavFile: string): string {
  const quoted = quoteShellArg(wavFile)
  if (template.includes(VOICE_FILE_PLACEHOLDER)) return template.split(VOICE_FILE_PLACEHOLDER).join(quoted)
  return `${template} ${quoted}`
}

/** Run the user's transcription command and return its stdout, trimmed. */
export function transcribeAudio(wavFile: string, template: string): Promise<string> {
  const shell = buildTranscribeShellCommand(template, wavFile)
  const command = process.platform === "win32" ? "cmd.exe" : "sh"
  const args = process.platform === "win32" ? ["/d", "/s", "/c", shell] : ["-c", shell]
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(new Error(`Voice transcription failed: ${error.message}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

/** True when the key was held for such a short time it counts as a tap. */
export function shouldDiscardTap(holdMs: number): boolean {
  return holdMs < VOICE_MIN_HOLD_MS
}

/**
 * True when a press is the key being held down rather than a fresh press.
 * Without terminal event reporting, auto-repeat arrives as ordinary presses
 * with no marker, so presses closer together than the guard window count as
 * repeats. The window must outlast the OS initial repeat delay (about 500 to
 * 660ms by default) and chains: every press, repeat or not, restarts it.
 */
export function isRepeatPress(sinceLastPressMs: number, repeated?: boolean): boolean {
  return repeated === true || sinceLastPressMs < VOICE_REPEAT_GUARD_MS
}
