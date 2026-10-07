import { afterEach, expect, test } from "bun:test"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createVoiceService } from "./voice-service"
import { localVoiceModel } from "@opencode-ai/app/voice/types"

const cleanup: (() => Promise<unknown> | void)[] = []
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action()
})

async function setup() {
  const requests: { url: string; auth?: string; body: string }[] = []
  const arrived = Promise.withResolvers<void>()
  const behavior = { status: 200, response: { text: "actual endpoint transcript" } as unknown, hold: false }
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({ url: request.url!, auth: request.headers.authorization, body: Buffer.concat(chunks).toString() })
    arrived.resolve()
    if (behavior.hold) return
    response.writeHead(behavior.status, { "content-type": "application/json" })
    response.end(JSON.stringify(request.url === "/v1/models" ? { data: [] } : behavior.response))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => {
    server.closeAllConnections()
    server.close()
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("address")
  const root = await mkdtemp(join(tmpdir(), "opencode-voice-test-"))
  cleanup.push(() => rm(root, { force: true, recursive: true }))
  const data = new Map<string, unknown>()
  const service = createVoiceService({
    root,
    workerPath: "unused",
    supported: false,
    store: {
      get: (key) => data.get(key),
      set: (key, value) => {
        data.set(key, structuredClone(value))
      },
      delete: (key) => {
        data.delete(key)
      },
    },
    encrypt: (key) => `encrypted:${Buffer.from(key).toString("base64")}`,
    decrypt: (key) => Buffer.from(key.slice(10), "base64").toString(),
    emit: () => {},
  })
  cleanup.push(service.close)
  const provider = {
    id: "speech-test",
    name: "Speech test",
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    models: [{ id: "asr-test", name: "ASR test", visible: true }],
  }
  return { service, data, provider, requests, behavior, arrived: arrived.promise }
}

const audio = new TextEncoder().encode("RIFF-test-WAV-audio").buffer as ArrayBuffer

test("persists provider and selection while keeping credentials out of snapshots", async () => {
  const { service, data, provider } = await setup()
  expect((await service.save(provider, "test-secret")).ok).toBe(true)
  const state = await service.configure({ providerID: provider.id, modelID: "asr-test" }, "ko")
  expect(state.selected).toEqual({ providerID: provider.id, modelID: "asr-test" })
  expect(JSON.stringify(state)).not.toContain("test-secret")
  expect(data.get(`secret.${provider.id}`)).not.toBe("test-secret")
  expect((await service.read()).providers[0]?.hasKey).toBe(true)
  expect((await service.remove(provider.id)).selected).toBeUndefined()
  expect(data.has(`secret.${provider.id}`)).toBe(false)
})

test("uses the selected provider endpoint with WAV multipart input, model and language", async () => {
  const { service, provider, requests } = await setup()
  await service.save(provider, "test-secret")
  expect((await service.test(provider.id)).ok).toBe(true)
  const result = await service.transcribe(
    { id: "one", selection: { providerID: provider.id, modelID: "asr-test" }, audio, language: "ko" },
    "window-1",
  )
  expect(result).toEqual({ ok: true, value: "actual endpoint transcript" })
  expect(requests[1]?.url).toBe("/v1/audio/transcriptions")
  expect(requests[1]?.auth).toBe("Bearer test-secret")
  expect(requests[1]?.body).toContain('filename="recording.wav"')
  expect(requests[1]?.body).toContain("asr-test")
  expect(requests[1]?.body).toContain('name="language"\r\n\r\nko')
})

test("rejects unknown models and invalid providers without sending audio", async () => {
  const { service, provider, requests } = await setup()
  expect(await service.save({ ...provider, baseURL: "file:///tmp/audio" })).toEqual({
    ok: false,
    error: "configuration",
  })
  expect(await service.save({ ...provider, baseURL: "https://secret:password@example.com" })).toEqual({
    ok: false,
    error: "configuration",
  })
  await service.save(provider)
  expect(
    await service.transcribe(
      { id: "one", selection: { providerID: provider.id, modelID: "chat-only-model" }, audio, language: "auto" },
      "window-1",
    ),
  ).toEqual({ ok: false, error: "configuration" })
  expect(requests).toHaveLength(0)
  expect(
    await service.configure({ providerID: localVoiceModel.providerID, modelID: localVoiceModel.modelID }, "auto"),
  ).toMatchObject({ selected: undefined })
  expect(await service.install("window-1")).toEqual({ ok: false, error: "unsupported" })
})

test("reports authentication, invalid output and empty speech without treating them as text", async () => {
  const { service, provider, behavior } = await setup()
  await service.save(provider)
  const request = {
    id: "one",
    selection: { providerID: provider.id, modelID: "asr-test" },
    audio,
    language: "auto" as const,
  }
  behavior.status = 401
  expect(await service.transcribe(request, "window-1")).toEqual({ ok: false, error: "authentication" })
  behavior.status = 200
  behavior.response = { error: "private server details" }
  expect(await service.transcribe(request, "window-1")).toEqual({ ok: false, error: "response" })
  behavior.response = { text: "   " }
  expect(await service.transcribe(request, "window-1")).toEqual({ ok: false, error: "empty" })
})

test("cancels only the owning window's request", async () => {
  const { service, provider, behavior, arrived } = await setup()
  await service.save(provider)
  behavior.hold = true
  const pending = service.transcribe(
    { id: "one", selection: { providerID: provider.id, modelID: "asr-test" }, audio, language: "auto" },
    "window-1",
  )
  await arrived
  service.cancel("window-2", "one")
  service.cancel("window-1", "one")
  expect(await pending).toEqual({ ok: false, error: "cancelled" })
})

test("preserves external language codes and execution location on an unsupported managed-runtime host", async () => {
  const { service, provider, requests } = await setup()
  await service.save({ ...provider, adapter: "transcription-api", location: "remote" })
  const state = await service.configure({ providerID: provider.id, modelID: "asr-test" }, "ja")
  expect(state.language).toBe("ja")
  expect(state.local.supported).toBe(false)
  expect(state.providers[0]?.location).toBe("remote")
  expect(
    await service.transcribe(
      { id: "japanese", selection: state.selected!, audio, language: state.language },
      "window-1",
    ),
  ).toEqual({ ok: true, value: "actual endpoint transcript" })
  expect(requests[0]?.body).toContain('name="language"\r\n\r\nja')
})

test("automatic-only endpoint omits a saved language hint", async () => {
  const { service, provider, requests } = await setup()
  await service.save({ ...provider, models: [{ ...provider.models[0]!, languages: [] }] })
  expect(
    (
      await service.transcribe(
        { id: "auto", selection: { providerID: provider.id, modelID: "asr-test" }, audio, language: "ko" },
        "window-1",
      )
    ).ok,
  ).toBe(true)
  expect(requests[0]?.body).not.toContain('name="language"')
})

test.each([
  ["auto", undefined, { message: { content: "language Korean<asr_text>테스트<|im_end|>" } }],
  ["ko", "Korean", { response: "테스트<|im_end|>" }],
  ["en", "English", { response: "테스트" }],
  ["ja", "Japanese", { response: "language Japanese<asr_text>테스트" }],
] as const)(
  "Ollama Qwen applies General language %s without requiring a legacy protocol field",
  async (language, name, response) => {
    const { service, provider, requests, behavior } = await setup()
    await service.save({ ...provider, adapter: "ollama-qwen", location: "remote" })
    behavior.response = response
    const wav = Buffer.alloc(46)
    wav.write("RIFF", 0)
    wav.writeUInt32LE(38, 4)
    wav.write("WAVEfmt ", 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(16000, 24)
    wav.writeUInt32LE(32000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write("data", 36)
    wav.writeUInt32LE(2, 40)
    expect(
      await service.transcribe(
        {
          id: "ollama",
          selection: { providerID: provider.id, modelID: "asr-test" },
          audio: new Uint8Array(wav).buffer,
          language,
        },
        "window-1",
      ),
    ).toEqual({ ok: true, value: "테스트" })
    expect(requests[0]?.url).toBe(name ? "/api/generate" : "/api/chat")
    const body = JSON.parse(requests[0]!.body)
    expect(body.model).toBe("asr-test")
    expect(body.stream).toBe(false)
    if (!name) {
      expect(body.messages).toEqual([{ role: "user", content: "", images: [wav.toString("base64")] }])
      expect(body.raw).toBeUndefined()
      return
    }
    expect(body.raw).toBe(true)
    expect(body.images).toEqual([wav.toString("base64")])
    expect(body.prompt).toBe(
      `<|im_start|>system\n<|im_end|>\n<|im_start|>user\n[img-0]<|im_end|>\n<|im_start|>assistant\nlanguage ${name}<asr_text>`,
    )
    expect(body.messages).toBeUndefined()
  },
)
