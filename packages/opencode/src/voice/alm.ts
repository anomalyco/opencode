import z from "zod"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Log } from "@/util/log"
import { buildPrompt, getLastAssistantText, toWavOrMp3 } from "@/voice/whisper"

const log = Log.create({ service: "alm" })

const buildMessages = (input: { system?: string; context?: string; audio: string }) => {
  const system = (
    input.system ?? "You are a professional speech-to-text transcriber. Your task is to transcribe the audio into text."
  ).trim()
  const context = input.context?.trim()
  const text = context
    ? `${system}\n<context>\n${context}\n</context>\nDO NOT answer user's question, just transcribe the audio into text.`
    : system
  return [
    {
      role: "system" as const,
      content: text,
    },
    {
      role: "user" as const,
      content: [
        { type: "audio_url", audio_url: { url: input.audio } },
        {
          type: "text",
          text: "you are a professional speech to text transcriber, your task is to transcribe the audio into text.",
        },
      ],
    },
  ]
}

export namespace Alm {
  export const Request = z.object({
    file: z.instanceof(File),
    mime: z.string(),
    sessionID: z.string().optional(),
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
    const alm = voice?.alm
    const apiKey = alm?.apiKey
    if (!apiKey) {
      throw new Error("Missing voice.alm.apiKey")
    }

    const content = await input.file.arrayBuffer()
    const prepared = await toWavOrMp3({ buffer: content, mime: input.mime })
    const audio = `data:${prepared.mime};base64,${Buffer.from(prepared.buffer).toString("base64")}`

    const assistant = await getLastAssistantText(input.sessionID)
    const context = buildPrompt({ assistant, prompt: buildPrompt({ assistant: alm?.prompt, prompt: input.prompt }) })
    const messages = buildMessages({
      system: alm?.system,
      context,
      audio,
    })

    const payload = {
      model: alm?.model ?? "gpt-4o-mini-transcribe",
      messages,
      temperature: 0,
    }

    const url = alm?.url ?? "https://api.openai.com/v1/chat/completions"
    log.info("request", {
      url,
      model: payload.model,
      bytes: prepared.buffer.byteLength,
    })

    const result = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: input.signal,
    })

    if (!result.ok) {
      await result.text().catch(() => {})
      throw new Error("ALM request failed")
    }

    const body = await result.text().catch(() => "")
    log.info("response", { bytes: body.length })
    let parsed: { choices?: Array<{ message?: { content?: string } }> }
    try {
      parsed = body ? JSON.parse(body) : {}
    } catch {
      parsed = {}
    }
    const text = parsed?.choices?.[0]?.message?.content
    return Response.parse({ text: typeof text === "string" ? text : "" })
  }
}
