import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

let listener: ((line: string) => void) | undefined
let lastLine = ""

function logPath() {
  const dir = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode")
  mkdirSync(dir, { recursive: true })
  return join(dir, "voice-tui.log")
}

export function voiceLogPath() {
  return logPath()
}

export function voiceLogLast() {
  return lastLine
}

export function setVoiceLogListener(fn: ((line: string) => void) | undefined) {
  listener = fn
}

export function voiceLog(message: string) {
  const line = `${new Date().toISOString().slice(11, 23)} ${message}`
  lastLine = line
  appendFileSync(logPath(), `${line}\n`)
  listener?.(line)
  if (process.env.VOICE_DEBUG === "1") process.stderr.write(`voice: ${line}\n`)
}

export function voiceLogOnce(key: string, message: string) {
  if (voiceLogOnce.seen.has(key)) return
  voiceLogOnce.seen.add(key)
  voiceLog(message)
}

voiceLogOnce.seen = new Set<string>()

export function voiceLogResetOnce() {
  voiceLogOnce.seen.clear()
}

export function voiceLogStage(stage: "REPLY" | "TTS" | "API" | "PLAY" | "STATE", message: string) {
  voiceLog(`[${stage}] ${message}`)
}
