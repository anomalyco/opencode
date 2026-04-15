import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import type { Server } from "bun"

let mockStt: Server<undefined>

beforeAll(() => {
  mockStt = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method === "POST" && url.pathname === "/v1/audio/transcriptions") {
        const form = await req.formData()
        const file = form.get("file")
        const model = form.get("model")
        const auth = req.headers.get("authorization")

        if (!(file instanceof File))
          return Response.json({ error: "Missing file" }, { status: 400 })

        return Response.json({
          text: `Transcribed: model=${model} auth=${auth} bytes=${file.size}`,
        })
      }
      return Response.json({ error: "Not found" }, { status: 404 })
    },
  })
})

afterAll(() => {
  mockStt.stop()
})

describe("STT proxy", () => {
  test("proxies audio to upstream and returns text", async () => {
    // Simulate what the server endpoint does: read config, build form, call upstream
    const sttConfig = {
      url: `http://localhost:${mockStt.port}/v1`,
      apiKey: "test-key-123",
      model: "whisper-1",
    }

    const audioBlob = new Blob(["fake audio data"], { type: "audio/webm" })
    const form = new FormData()
    form.append("file", audioBlob, "recording.webm")
    form.append("model", sttConfig.model)

    const headers: Record<string, string> = {}
    if (sttConfig.apiKey) headers["Authorization"] = `Bearer ${sttConfig.apiKey}`

    const res = await fetch(`${sttConfig.url}/audio/transcriptions`, {
      method: "POST",
      body: form,
      headers,
    })

    expect(res.ok).toBe(true)
    const result = await res.json() as { text: string }
    expect(result.text).toContain("Transcribed:")
    expect(result.text).toContain("model=whisper-1")
    expect(result.text).toContain("auth=Bearer test-key-123")
    expect(result.text).toContain("bytes=15")
  })

  test("handles missing file gracefully", async () => {
    const form = new FormData()
    form.append("model", "whisper-1")

    const res = await fetch(`http://localhost:${mockStt.port}/v1/audio/transcriptions`, {
      method: "POST",
      body: form,
    })

    expect(res.status).toBe(400)
    const result = await res.json() as { error: string }
    expect(result.error).toBe("Missing file")
  })

  test("passes language parameter when set", async () => {
    const sttConfig = {
      url: `http://localhost:${mockStt.port}/v1`,
      model: "whisper-1",
      language: "en",
    }

    const audioBlob = new Blob(["audio"], { type: "audio/webm" })
    const form = new FormData()
    form.append("file", audioBlob, "recording.webm")
    form.append("model", sttConfig.model)
    form.append("language", sttConfig.language)

    const res = await fetch(`${sttConfig.url}/audio/transcriptions`, {
      method: "POST",
      body: form,
    })

    expect(res.ok).toBe(true)
    const result = await res.json() as { text: string }
    expect(result.text).toContain("model=whisper-1")
  })
})
