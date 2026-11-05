import { describe, expect, test } from "bun:test"
import { voiceMode } from "~/component/site/voice/flag"
import { POST as answer } from "~/routes/api/voice/answer"
import { GET as capabilities } from "~/routes/api/voice/capabilities"
import { POST as speech } from "~/routes/api/voice/speech"
import { POST as transcribe } from "~/routes/api/voice/transcribe"

// With voice mode off for launch (voice/flag.ts), its API is gone too: every route answers 404 before
// reading the request, so nothing reaches a model, ElevenLabs or Zen whatever keys are set.
describe("voice API with voice mode off", () => {
  const event = (body: unknown) =>
    ({
      request: new Request("http://localhost/api/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    }) as Parameters<typeof answer>[0]

  test("the flag is off", () => expect(voiceMode).toBe(false))

  test("every route is a 404", async () => {
    process.env.OPENCODE_API_KEY = "test"
    process.env.ELEVENLABS_API_KEY = "test"
    const calls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response("{}")
    }) as typeof fetch
    try {
      const responses = await Promise.all([
        answer(event({ question: "What is OpenCode?" })),
        speech(event({ text: "Hello" })),
        transcribe(event({})),
        capabilities(),
      ])
      expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404])
      expect(calls).toEqual([])
    } finally {
      globalThis.fetch = realFetch
      delete process.env.OPENCODE_API_KEY
      delete process.env.ELEVENLABS_API_KEY
    }
  })
})
