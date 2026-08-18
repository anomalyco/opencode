import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLocalVoice } from "./local-voice"

describe("local voice", () => {
  test("reports runtime and model availability", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-local-voice-"))
    const voice = createLocalVoice({
      root,
      runtime: join(root, "missing-whisper-cli"),
      fetch: () => Promise.reject(new Error("unexpected download")),
    })
    try {
      const state = await voice.state()
      expect(state.runtime).toBe(false)
      expect(state.transcribing).toBe(false)
      expect(state.models.base).toEqual({ size: 147_951_465, installed: false })
    } finally {
      voice.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects malformed audio before starting the runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-local-voice-"))
    const voice = createLocalVoice({
      root,
      runtime: join(root, "missing-whisper-cli"),
      fetch: () => Promise.reject(new Error("unexpected download")),
    })
    try {
      await expect(voice.transcribe({ model: "base", audio: new ArrayBuffer(44) })).rejects.toThrow("Invalid WAV audio")
    } finally {
      voice.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("cancels a model download and removes its partial file", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-local-voice-"))
    const started = Promise.withResolvers<void>()
    const voice = createLocalVoice({
      root,
      runtime: join(root, "missing-whisper-cli"),
      fetch: (_url, input) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(1024))
                started.resolve()
                input.signal.addEventListener("abort", () => controller.error(input.signal.reason), { once: true })
              },
            }),
          ),
        ),
    })
    try {
      const download = voice.download("tiny")
      await started.promise
      await voice.cancelDownload("tiny")
      await expect(download).resolves.toBeUndefined()
      expect((await voice.state()).models.tiny.download).toBeUndefined()
      expect(await Bun.file(join(root, "models", "ggml-tiny.bin.part")).exists()).toBe(false)
    } finally {
      voice.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
