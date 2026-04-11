import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { SessionID } from "@/session/schema"
import { tmpdir } from "os"
import path from "path"
import z from "zod"
import { Log } from "@/util/log"

const log = Log.create({ service: "whisper" })

export const toWavOrMp3 = async (input: { buffer: ArrayBuffer; mime: string }) => {
  const isWav = input.mime.includes("wav")
  const isMp3 = input.mime.includes("mpeg") || input.mime.includes("mp3")
  if (isWav || isMp3) {
    const name = isWav ? "audio.wav" : "audio.mp3"
    const mime = isWav ? "audio/wav" : "audio/mpeg"
    return { buffer: input.buffer, name, mime }
  }

  const outPath = path.join(tmpdir(), `opencode-voice-${crypto.randomUUID()}.mp3`)
  const proc = Bun.spawn(
    ["ffmpeg", "-y", "-f", "webm", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "mp3", outPath],
    {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    },
  )
  try {
    proc.stdin?.write(new Uint8Array(input.buffer))
    proc.stdin?.end()
    await proc.exited
    const file = Bun.file(outPath, { type: "audio/mpeg" })
    const buffer = await file.arrayBuffer().catch(() => undefined)
    await Bun.file(outPath)
      .delete()
      .catch(() => {})
    if (!buffer) throw new Error("Failed to convert audio")
    return { buffer, name: "audio.mp3", mime: "audio/mpeg" }
  } finally {
    await Bun.file(outPath)
      .delete()
      .catch(() => {})
    try {
      proc.kill()
    } catch {}
  }
}

export const getLastAssistantText = async (sessionID?: string) => {
  if (!sessionID) return ""
  const { Session } = await import("@/session")
  try {
    const items = await AppRuntime.runPromise(
      Session.Service.use((svc) => svc.messages({ sessionID: sessionID as SessionID, limit: 50 })),
    )
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const msg = items[i]
      if (msg.info.role !== "assistant") continue
      const text = msg.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .trim()
      if (text) return text
    }
    return ""
  } catch (err) {
    log.error("session lookup failed", { error: String(err) })
    return ""
  }
}

export const buildPrompt = (input: { prompt?: string; assistant?: string }) => {
  const head = input.assistant?.trim() ?? ""
  const tail = input.prompt?.trim() ?? ""
  if (!head) return tail
  if (!tail) return head
  return `${head} ${tail}`
}

export namespace Whisper {
  export const Request = z.object({
    file: z.instanceof(File),
    mime: z.string(),
    sessionID: SessionID.zod.optional(),
    prompt: z.string().optional(),
  })

  export const Response = z.object({
    text: z.string().default(""),
  })

  export type Response = z.infer<typeof Response>

  export async function transcribe(
    input: z.infer<typeof Request> & { signal?: AbortSignal; voice?: Config.Info["voice"] },
  ) {
    const cfg = await AppRuntime.runPromise(Config.Service.use((svc) => svc.get()))
    const voice = input.voice ?? cfg.voice
    const whisper = voice?.whisper
    const apiKey = whisper?.apiKey
    if (!apiKey) {
      throw new Error("Missing voice.whisper.apiKey")
    }

    const content = await input.file.arrayBuffer()
    const prepared = await toWavOrMp3({
      buffer: content,
      mime: input.mime,
    })

    const assistant = await getLastAssistantText(input.sessionID)
    const prompt = buildPrompt({ assistant, prompt: input.prompt })

    const form = new FormData()
    form.append("file", new Blob([prepared.buffer], { type: prepared.mime }), prepared.name)
    form.append("model", whisper?.model ?? "whisper-1")
    form.append("response_format", "json")
    if (whisper?.language) {
      form.append("language", whisper.language)
    }
    if (prompt) {
      form.append("prompt", prompt)
    }

    const url = whisper?.url ?? "https://api.openai.com/v1/audio/transcriptions"
    log.info("request", {
      url,
      model: whisper?.model ?? "whisper-1",
      language: whisper?.language,
      bytes: prepared.buffer.byteLength,
    })
    const result = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: input.signal,
    })

    if (!result.ok) {
      await result.text().catch(() => {})
      throw new Error("Whisper request failed")
    }

    const contentType = result.headers.get("content-type") ?? ""
    const body = await result.text().catch(() => "")
    log.info("response", { contentType, bytes: body.length })
    let payload: { text?: string }
    try {
      payload = body ? JSON.parse(body) : { text: "" }
    } catch {
      payload = { text: "" }
    }
    const text = typeof payload?.text === "string" ? payload.text : ""
    return Response.parse({ text })
  }
}
