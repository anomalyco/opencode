export * as Voice from "./index"

import os from "os"
import path from "path"
import { rm } from "fs/promises"
import { existsSync } from "fs"
import { createSignal } from "solid-js"

export type VoiceState = "idle" | "recording" | "transcribing"

export type VoiceConfig = {
  enabled?: boolean
  whisper_command?: string[]
  record_command?: string[]
  language?: string
  max_seconds?: number
}

export type VoiceController = ReturnType<typeof createVoiceController>

const DEFAULT_MAX_SECONDS = 60
const DEFAULT_LANGUAGE = "auto"

// Platform-aware default recorder. Uses ffmpeg with a duration cap (`-t`)
// so the file is finalized even if the process is killed ungracefully. On
// Windows the dshow input device name varies per machine, so users should
// override `record_command` in tui.json to match their microphone.
function defaultRecordCommand(): string[] {
  const cap = "{max_seconds}"
  switch (process.platform) {
    case "darwin":
      return [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "avfoundation",
        "-i",
        ":default",
        "-t",
        cap,
        "-ar",
        "16000",
        "-ac",
        "1",
        "{output}",
      ]
    case "linux":
      return [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "pulse",
        "-i",
        "default",
        "-t",
        cap,
        "-ar",
        "16000",
        "-ac",
        "1",
        "{output}",
      ]
    case "win32":
      return [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "dshow",
        "-i",
        "audio=Microphone",
        "-t",
        cap,
        "-ar",
        "16000",
        "-ac",
        "1",
        "{output}",
      ]
    default:
      return [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-t",
        cap,
        "-ar",
        "16000",
        "-ac",
        "1",
        "{output}",
      ]
  }
}

function defaultWhisperCommand(): string[] {
  return ["whisper", "{audio}", "--language", "{language}", "--output_format", "txt", "--output_dir", "{output_dir}"]
}

function fillTemplate(args: string[], vars: Record<string, string | number>): string[] {
  return args.map((arg) => {
    let out = arg
    for (const [key, value] of Object.entries(vars)) {
      out = out.split(`{${key}}`).join(String(value))
    }
    return out
  })
}

function isMissingTemplate(args: string[]): boolean {
  return args.some((arg) => /\{[^}]+\}/.test(arg))
}

export function createVoiceController(config: () => VoiceConfig | undefined) {
  const [state, setState] = createSignal<VoiceState>("idle")
  const [elapsed, setElapsed] = createSignal(0)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [notice, setNotice] = createSignal<string | undefined>(undefined)

  let recorder: ReturnType<typeof Bun.spawn> | undefined
  let whisperProc: ReturnType<typeof Bun.spawn> | undefined
  let elapsedTimer: NodeJS.Timeout | undefined
  let maxTimer: NodeJS.Timeout | undefined
  let startedAt = 0
  let audioPath: string | undefined
  const maxSeconds = () => config()?.max_seconds ?? DEFAULT_MAX_SECONDS

  function clearMaxTimer() {
    if (maxTimer) {
      clearTimeout(maxTimer)
      maxTimer = undefined
    }
  }

  function clearElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = undefined
    }
  }

  function clearTimers() {
    clearMaxTimer()
    clearElapsedTimer()
  }

  async function start(): Promise<void> {
    if (state() !== "idle") return
    setError(undefined)
    setNotice(undefined)
    const cfg = config() ?? {}
    const recordCmd = cfg.record_command ?? defaultRecordCommand()

    audioPath = path.join(os.tmpdir(), `opencode-voice-${Date.now()}.wav`)
    const filled = fillTemplate(recordCmd, { output: audioPath, max_seconds: maxSeconds() })

    try {
      recorder = Bun.spawn({
        cmd: filled,
        stdout: "ignore",
        stderr: "pipe",
        stdin: "ignore",
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Failed to start recorder (${filled[0] ?? "?"}): ${msg}. Is ffmpeg installed?`)
      audioPath = undefined
      return
    }

    startedAt = Date.now()
    setState("recording")
    setElapsed(0)
    elapsedTimer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 250).unref()
    maxTimer = setTimeout(() => {
      setNotice("Max duration reached, transcribing…")
      void stop().catch((e) => setError(e instanceof Error ? e.message : String(e)))
    }, maxSeconds() * 1000).unref()

    // If the recorder exits immediately (e.g. missing device), surface the error.
    const rec = recorder
    void (async () => {
      const [code, stderrText] = await Promise.all([
        rec.exited,
        new Response(rec.stderr).text().catch(() => ""),
      ])
      if (state() !== "recording") return
      if (code !== 0 && code !== null) {
        clearTimers()
        setState("idle")
        const hint =
          process.platform === "win32"
            ? " Run `ffmpeg -list_devices true -f dshow -i dummy` to find your mic name, then set record_command in tui.json."
            : ""
        setError(`Recorder exited with code ${code}.${stderrText.trim() ? ` ${stderrText.trim()}` : ""}${hint}`)
        void cleanup()
      }
    })()
  }

  async function stop(): Promise<string | undefined> {
    if (state() !== "recording" || !audioPath) return undefined
    clearMaxTimer()

    // Ask ffmpeg to finalize gracefully. SIGINT lets it flush the WAV header.
    if (recorder) {
      try {
        process.kill(recorder.pid, "SIGINT")
      } catch {
        try {
          recorder.kill()
        } catch {}
      }
      await recorder.exited.catch(() => undefined)
    }
    recorder = undefined

    // Keep the elapsed timer running, now counting transcription time.
    startedAt = Date.now()
    setElapsed(0)
    setState("transcribing")

    const text = await transcribe()
    clearElapsedTimer()
    setState("idle")
    void cleanup()
    return text
  }

  async function transcribe(): Promise<string | undefined> {
    if (!audioPath || !existsSync(audioPath)) {
      setError("No audio captured. Check your microphone / record_command config.")
      return undefined
    }
    const cfg = config() ?? {}
    const whisperCmd = cfg.whisper_command ?? defaultWhisperCommand()
    const language = cfg.language ?? DEFAULT_LANGUAGE
    const outputDir = path.dirname(audioPath)
    const filled = fillTemplate(whisperCmd, {
      audio: audioPath,
      language,
      output_dir: outputDir,
    })

    if (isMissingTemplate(filled)) {
      setError(`whisper_command has unfilled placeholders: ${filled.join(" ")}`)
      return undefined
    }

    let stdout: string | undefined
    let stderr: string | undefined
    try {
      whisperProc = Bun.spawn({
        cmd: filled,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      })
      const [out, err, code] = await Promise.all([
        new Response(whisperProc.stdout).text().catch(() => ""),
        new Response(whisperProc.stderr).text().catch(() => ""),
        whisperProc.exited,
      ])
      stdout = out
      stderr = err
      if (code !== 0) {
        setError(`Whisper exited with code ${code}. ${stderr?.trim() ?? ""}`)
        return undefined
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        `Failed to run whisper (${filled[0] ?? "?"}): ${msg}. Is it installed? You can also set whisper_command in tui.json to use whisper-cpp or faster-whisper.`,
      )
      return undefined
    } finally {
      whisperProc = undefined
    }

    // whisper writes <basename>.txt next to the audio when --output_dir is the audio's dir.
    const txtPath = audioPath.replace(/\.wav$/i, ".txt")
    if (existsSync(txtPath)) {
      const text = (await Bun.file(txtPath).text()).trim()
      if (text) return text
    }
    // Some whisper builds print the transcript to stdout instead.
    const fromStdout = stdout?.trim()
    if (fromStdout) return fromStdout
    // Empty transcript — likely silence. Not an error, just nothing to insert.
    return undefined
  }

  async function cleanup() {
    if (audioPath) {
      const base = audioPath.replace(/\.wav$/i, "")
      await Promise.all([
        rm(audioPath, { force: true }),
        rm(`${base}.txt`, { force: true }),
      ]).catch(() => {})
      audioPath = undefined
    }
  }

  async function cancel(): Promise<void> {
    clearTimers()
    if (recorder) {
      try {
        recorder.kill()
      } catch {}
      await recorder.exited.catch(() => undefined)
      recorder = undefined
    }
    if (whisperProc) {
      try {
        whisperProc.kill()
      } catch {}
      await whisperProc.exited.catch(() => undefined)
      whisperProc = undefined
    }
    setState("idle")
    await cleanup()
  }

  return {
    state,
    elapsed,
    error,
    notice,
    start,
    stop,
    cancel,
    get isEnabled() {
      return config()?.enabled !== false
    },
  }
}
