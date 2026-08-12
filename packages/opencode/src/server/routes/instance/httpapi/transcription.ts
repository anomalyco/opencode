import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { homedir, tmpdir } from "node:os"
import { unlink } from "node:fs/promises"
import { join } from "node:path"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { isRecord } from "@/util/record"

export const transcriptionRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service

    yield* router.add("POST", "/api/audio/transcribe", (request) => transcribe(request, config, auth))
  }),
)

function transcribe(request: HttpServerRequest.HttpServerRequest, config: Config.Interface, auth: Auth.Interface) {
  return Effect.gen(function* () {
    const bytes = yield* request.arrayBuffer.pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!bytes || bytes.byteLength === 0) return HttpServerResponse.jsonUnsafe({ error: "Audio file is required" }, { status: 400 })

    const url = Option.getOrElse(HttpServerRequest.toURL(request), () => {
      const protocol = request.headers["x-forwarded-proto"] === "https" ? "https" : "http"
      return new URL(request.url, `${protocol}://${request.headers.host ?? "0.0.0.0"}`)
    })
    const providerID = url.searchParams.get("provider") ?? "openai"
    const requestedModel = url.searchParams.get("model")
    const language = url.searchParams.get("language")
    const contentType = request.headers["content-type"] ?? "audio/webm"
    const localFallback = () =>
      Effect.tryPromise(() => transcribeLocally(bytes, contentType, localModel(requestedModel), language)).pipe(
        Effect.catch(() => Effect.succeed("")),
      )

    if (providerID === "local") {
      const text = yield* localFallback()
      if (!text) return HttpServerResponse.jsonUnsafe({ error: "Local Whisper returned no text" }, { status: 422 })
      return HttpServerResponse.jsonUnsafe({ text })
    }

    const loaded = yield* config.getGlobal()
    const providers = isRecord(loaded) && isRecord(loaded.provider) ? loaded.provider : {}
    const provider = isRecord(providers[providerID]) ? providers[providerID] : undefined
    const options = provider && isRecord(provider.options) ? provider.options : {}
    const credential = yield* auth.get(providerID)
    const apiKey = typeof options.apiKey === "string" ? options.apiKey : credentialKey(credential)
    if (!apiKey) {
      const text = yield* localFallback()
      if (text) return HttpServerResponse.jsonUnsafe({ text })
      return HttpServerResponse.jsonUnsafe({ error: `No API key configured for ${providerID}` }, { status: 400 })
    }

    const baseURL =
      typeof options.baseURL === "string"
        ? options.baseURL
        : typeof provider?.api === "string"
          ? provider.api
          : providerID === "openai"
            ? "https://api.openai.com/v1"
            : undefined
    if (!baseURL) return HttpServerResponse.jsonUnsafe({ error: `No base URL configured for ${providerID}` }, { status: 400 })

    const body = new FormData()
    body.append("file", new Blob([bytes], { type: contentType }), request.headers["x-filename"] ?? "voice.webm")
    body.append(
      "model",
      requestedModel ?? (typeof options.transcriptionModel === "string" ? options.transcriptionModel : "gpt-4o-mini-transcribe"),
    )
    if (language && language !== "auto") body.append("language", language)

    const response = yield* Effect.tryPromise(() =>
      fetch(`${baseURL.replace(/\/$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
      }),
    ).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!response || !response.ok) {
      const text = yield* localFallback()
      if (text) return HttpServerResponse.jsonUnsafe({ text })
      return HttpServerResponse.jsonUnsafe(
        { error: response ? "Transcription provider rejected the audio" : "Transcription provider is unavailable" },
        { status: 502 },
      )
    }

    const result: unknown = yield* Effect.tryPromise(() => response.json()).pipe(Effect.catch(() => Effect.succeed(undefined)))
    const text = isRecord(result) && typeof result.text === "string" ? result.text.trim() : ""
    if (!text) return HttpServerResponse.jsonUnsafe({ error: "Transcription returned no text" }, { status: 422 })
    return HttpServerResponse.jsonUnsafe({ text })
  })
}

function localModel(value: string | null) {
  if (value && ["tiny", "base", "small", "medium", "large-v3"].includes(value)) return value
  return "medium"
}

async function transcribeLocally(bytes: ArrayBuffer, contentType: string, model: string, language: string | null) {
  const extension = contentType.includes("mp4") ? "mp4" : contentType.includes("ogg") ? "ogg" : "webm"
  const file = join(tmpdir(), `opencode-voice-${crypto.randomUUID()}.${extension}`)
  await Bun.write(file, bytes)
  try {
    const python = process.env.OPENCODE_WHISPER_PYTHON ?? join(homedir(), ".cache/opencode-whisper/bin/python")
    const script = join(import.meta.dir, "../../../../../script/transcribe.py")
    const child = Bun.spawn(
      [python, script, "--file", file, "--model", model, ...(language && language !== "auto" ? ["--language", language] : [])],
      {
      stdout: "pipe",
      stderr: "pipe",
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (exitCode !== 0) throw new Error(stderr || "Local Whisper failed")
    const result: unknown = JSON.parse(stdout)
    if (!isRecord(result) || typeof result.text !== "string") throw new Error("Invalid local Whisper response")
    return result.text.trim()
  } finally {
    await unlink(file).catch(() => undefined)
  }
}

function credentialKey(value: Auth.Info | undefined) {
  if (!value || value.type === "oauth") return value?.access
  if (value.type === "api" || value.type === "wellknown") return value.key
}
