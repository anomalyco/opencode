export type VoiceLogStage = "REPLY" | "TTS" | "API" | "PLAY" | "STATE" | "RUNTIME"

const MAX_LINES = 800

const buffer: string[] = []
let pending: string[] = []
let flushScheduled = false
let sidecarUrl: (() => string) | undefined
let enabled = true

function debugEnabled() {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem("opencode.voice.debug") === "1"
}

function queueFlush(line: string) {
  if (!enabled) return
  pending.push(line)
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => {
    flushScheduled = false
    void flushPending()
  })
}

let flushWarned = false

function warnFlushOnce(message: string) {
  if (flushWarned) return
  flushWarned = true
  console.warn(`voice log: ${message}`)
}

async function flushPending() {
  const lines = pending.splice(0)
  if (!lines.length) return
  if (!sidecarUrl) {
    warnFlushOnce("sidecar URL not configured — toggle voice off and on after sidecar starts")
    pending.unshift(...lines)
    return
  }
  const base = sidecarUrl().replace(/\/+$/, "")
  try {
    const res = await fetch(`${base}/voice/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenCode-Voice-Log": "web",
      },
      keepalive: true,
      body: JSON.stringify({ lines }),
    })
    if (!res.ok) {
      warnFlushOnce(`POST /voice/log failed (${res.status}) — restart sidecar on port 8765`)
      pending.unshift(...lines)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed"
    warnFlushOnce(`POST /voice/log error (${message}) — is sidecar running on 8765?`)
    pending.unshift(...lines)
  }
}

export function initVoiceLog(input?: { sidecarUrl?: () => string; active?: () => boolean }) {
  sidecarUrl = input?.sidecarUrl
  if (input?.active) {
    enabled = input.active()
  }
}

export function setVoiceLogEnabled(active: boolean) {
  enabled = active
  if (!active) {
    pending = []
    flushScheduled = false
    return
  }
  flushWarned = false
}

export function voiceLogLines() {
  return [...buffer]
}

export function voiceLogStage(stage: VoiceLogStage, message: string) {
  if (!enabled) return
  const line = `${new Date().toISOString().slice(11, 23)} [${stage}] ${message}`
  buffer.push(line)
  if (buffer.length > MAX_LINES) buffer.shift()
  if (debugEnabled()) console.debug(`voice ${line}`)
  queueFlush(line)
}

export function voiceLogOnce(key: string, stage: VoiceLogStage, message: string) {
  if (!voiceLogOnce.seen.has(key)) {
    voiceLogOnce.seen.add(key)
    voiceLogStage(stage, message)
  }
}

voiceLogOnce.seen = new Set<string>()

export function voiceLogResetOnce() {
  voiceLogOnce.seen.clear()
}
