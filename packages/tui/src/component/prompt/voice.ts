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
export function ffmpegArgs(platform: NodeJS.Platform, outputFile: string): string[] {
  const input =
    platform === "darwin"
      ? ["-f", "avfoundation", "-i", ":default"]
      : platform === "win32"
        ? ["-f", "dshow", "-i", "audio=default"]
        : ["-f", "pulse", "-i", "default"]
  return ["-hide_banner", "-loglevel", "error", ...input, "-ar", "16000", "-ac", "1", "-y", outputFile]
}

/** sox `rec` arguments that record the default microphone to a wav file. */
export function soxArgs(outputFile: string): string[] {
  return ["-r", "16000", "-c", "1", outputFile]
}

/** Pick the best available microphone recorder, if any. */
export function findRecorder(platform: NodeJS.Platform = process.platform): RecorderSpec | undefined {
  if (commandExists("ffmpeg")) {
    return { command: "ffmpeg", buildArgs: (outputFile) => ffmpegArgs(platform, outputFile) }
  }
  if (commandExists("rec")) {
    return { command: "rec", buildArgs: (outputFile) => soxArgs(outputFile) }
  }
  return undefined
}

function signal(proc: ChildProcess, sig: NodeJS.Signals): void {
  if (proc.exitCode === null && proc.signalCode === null) proc.kill(sig)
}

/**
 * Records microphone audio to a temporary wav file until stopped.
 * The recorder is terminated with SIGINT so encoders flush a valid wav
 * header; SIGKILL is only a fallback.
 */
export class VoiceRecorder {
  private proc: ChildProcess | undefined
  private file: string | undefined

  get recording(): boolean {
    return this.proc !== undefined
  }

  start(spec: RecorderSpec): void {
    if (this.proc) return
    const file = join(tmpdir(), `opencode-voice-${process.pid}-${Date.now()}.wav`)
    const proc = spawn(spec.command, spec.buildArgs(file), { stdio: "ignore" })
    proc.on("error", () => {
      if (this.proc === proc) {
        this.proc = undefined
        this.file = undefined
      }
    })
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
