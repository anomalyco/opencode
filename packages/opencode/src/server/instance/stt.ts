import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { AppRuntime } from "../../effect/app-runtime"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unlink } from "node:fs/promises"
import { which } from "../../util/which"
import { Process } from "../../util/process"

const TEMP_FILE = join(tmpdir(), "opencode-voice.wav")
const TOOLS = ["ffmpeg", "rec", "sox", "arecord"] as const
type Tool = (typeof TOOLS)[number]

let detectedTool: Tool | null | undefined
function pickTool(): Tool | null {
  if (detectedTool !== undefined) return detectedTool
  detectedTool = TOOLS.find((t) => which(t)) ?? null
  return detectedTool
}

function recordArgs(t: Tool): string[] {
  if (t === "ffmpeg") {
    const input =
      process.platform === "darwin" ? ["-f", "avfoundation", "-i", ":default"] : ["-f", "pulse", "-i", "default"]
    return ["ffmpeg", "-nostdin", ...input, "-ar", "16000", "-ac", "1", "-y", TEMP_FILE]
  }
  if (t === "rec") return ["rec", "-r", "16000", "-c", "1", TEMP_FILE]
  if (t === "sox") return ["sox", "-d", "-r", "16000", "-c", "1", TEMP_FILE]
  return ["arecord", "-f", "S16_LE", "-r", "16000", "-c", "1", TEMP_FILE]
}

let activeProc: Process.Child | undefined

function cleanupActiveProc() {
  if (!activeProc) return
  activeProc.kill("SIGKILL")
  activeProc = undefined
}

process.on("exit", cleanupActiveProc)
process.on("SIGINT", cleanupActiveProc)
process.on("SIGTERM", cleanupActiveProc)

async function transcribe(
  stt: { url: string; apiKey?: string; model?: string; language?: string },
  audio: Blob,
  filename: string,
) {
  const apiKey = stt.apiKey || process.env.OPENCODE_STT_API_KEY
  const form = new FormData()
  form.append("file", audio, filename)
  form.append("model", stt.model ?? "whisper-1")
  if (stt.language) form.append("language", stt.language)

  const headers: Record<string, string> = {}
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  const upstream = await fetch(`${stt.url}/audio/transcriptions`, {
    method: "POST",
    body: form,
    headers,
  }).catch((err: Error) => {
    throw new Error(`STT upstream error: ${err.message}`)
  })

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "Unknown error")
    return { error: `STT provider error: ${text}`, status: 502 as const }
  }

  const result = (await upstream.json()) as { text: string }
  return { text: result.text }
}

export const SttRoutes = lazy(() =>
  new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get STT status",
        description: "Check if speech-to-text is configured and enabled.",
        operationId: "stt.status",
        responses: {
          200: {
            description: "STT status",
            content: {
              "application/json": {
                schema: resolver(z.object({ enabled: z.boolean() })),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get()))
        return c.json({ enabled: !!config.stt })
      },
    )
    .post(
      "/transcribe",
      describeRoute({
        summary: "Transcribe audio",
        description: "Transcribe audio to text using the configured STT provider.",
        operationId: "stt.transcribe",
        responses: {
          200: {
            description: "Transcription result",
            content: {
              "application/json": {
                schema: resolver(z.object({ text: z.string() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get()))
        if (!config.stt) {
          return c.json({ error: "Speech-to-text is not configured" }, 400)
        }

        const body = await c.req.parseBody()
        const audio = body["audio"]
        if (!(audio instanceof File)) {
          return c.json({ error: "Missing audio file" }, 400)
        }

        const result = await transcribe(config.stt, audio, audio.name || "recording.webm")
        if ("error" in result) return c.json({ error: result.error }, result.status)
        return c.json({ text: result.text })
      },
    )
    .post(
      "/record/start",
      describeRoute({
        summary: "Start recording",
        description: "Start recording audio from the system microphone.",
        operationId: "stt.record.start",
        responses: {
          200: {
            description: "Recording started",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        if (activeProc) {
          return c.json({ error: "Already recording" }, 400)
        }
        const t = pickTool()
        if (!t) {
          return c.json({ error: "No recording tool found (install ffmpeg, sox, or arecord)" }, 400)
        }
        await unlink(TEMP_FILE).catch(() => {})
        const args = recordArgs(t)
        activeProc = Process.spawn(args, {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        })
        return c.json({ ok: true })
      },
    )
    .post(
      "/record/stop",
      describeRoute({
        summary: "Stop recording and transcribe",
        description: "Stop recording, then transcribe the captured audio.",
        operationId: "stt.record.stop",
        responses: {
          200: {
            description: "Transcription result",
            content: {
              "application/json": {
                schema: resolver(z.object({ text: z.string() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        if (!activeProc) {
          return c.json({ error: "Not recording" }, 400)
        }

        const p = activeProc
        activeProc = undefined
        p.kill("SIGINT")
        const exitCode = await Promise.race([
          p.exited.catch(() => -1),
          new Promise<number>((r) => setTimeout(() => r(-2), 3000)),
        ])
        if (exitCode === -2) p.kill("SIGKILL")

        const file = Bun.file(TEMP_FILE)
        const exists = await file.exists()
        if (!exists) {
          return c.json({ error: "No audio captured" }, 400)
        }
        const buf = Buffer.from(await file.arrayBuffer())
        if (buf.length <= 44) {
          return c.json({ error: "No audio captured" }, 400)
        }

        const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get()))
        if (!config.stt) {
          return c.json({ error: "Speech-to-text is not configured" }, 400)
        }

        const result = await transcribe(
          config.stt,
          new Blob([buf], { type: "audio/wav" }),
          "recording.wav",
        )
        if ("error" in result) return c.json({ error: result.error }, result.status)
        return c.json({ text: result.text })
      },
    )
    .get(
      "/record/status",
      describeRoute({
        summary: "Get recording status",
        description: "Check if audio is currently being recorded.",
        operationId: "stt.record.status",
        responses: {
          200: {
            description: "Recording status",
            content: {
              "application/json": {
                schema: resolver(z.object({ recording: z.boolean(), available: z.boolean() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ recording: !!activeProc, available: pickTool() !== null })
      },
    ),
)
