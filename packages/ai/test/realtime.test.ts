import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { HttpClientRequest } from "effect/http"
import { TestClock } from "effect/testing"
import { Realtime } from "../src/experimental.js"
import { it } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"

describe("experimental Realtime", () => {
  it.effect("connects OpenAI GPT-Live, OpenAI Realtime, xAI Grok Voice, and Google Gemini Live", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1760000000_000)

      expect(
        yield* Realtime.connect({
          model: "gpt-live-1",
          apiKey: Redacted.make("sk-openai"),
          session: { instructions: "Be concise.", voice: "marin" },
          transport: { type: "webrtc", sdp: "v=0\r\no=offer\r\n", dcid: 4 },
        }),
      ).toEqual({ type: "webrtc", sdp: "v=0\r\no=live-answer\r\n" })

      expect(
        yield* Realtime.connect({
          model: "gpt-realtime-2.1",
          apiKey: Redacted.make("sk-openai"),
          session: { type: "realtime", instructions: "Brief." },
          transport: { type: "webrtc", sdp: "v=0\r\no=offer\r\n", dcid: 4 },
        }),
      ).toEqual({ type: "webrtc", sdp: "v=0\r\no=rtc-answer\r\n" })

      expect(
        yield* Realtime.connect({
          model: "gpt-realtime-2.1",
          apiKey: Redacted.make("sk-openai"),
          session: { type: "realtime", instructions: "Brief." },
          transport: { type: "websocket" },
        }),
      ).toEqual({
        type: "websocket",
        url: "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1",
        token: "ek_1",
        expiresAt: 1760000060,
      })

      expect(
        yield* Realtime.connect({
          model: "grok-voice-3.0",
          apiKey: Redacted.make("xai-key"),
          session: { voice: "ara" },
          transport: { type: "websocket" },
        }),
      ).toEqual({
        type: "websocket",
        url: "wss://api.x.ai/v1/realtime?model=grok-voice-3.0",
        token: "ek_2",
        expiresAt: 1760000120,
      })

      expect(
        yield* Realtime.connect({
          model: "gemini-3.8-live",
          apiKey: Redacted.make("gemini-key"),
          session: {
            generationConfig: { responseModalities: ["AUDIO"] },
            systemInstruction: { parts: [{ text: "Brief." }] },
          },
          transport: { type: "websocket" },
        }),
      ).toEqual({
        type: "websocket",
        url: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
        token: "auth_tokens/ek_3",
        expiresAt: 1760000060,
      })
    }).pipe(
      Effect.provide(
        dynamicResponse((input) =>
          Effect.gen(function* () {
            const req = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
            if (req.url === "https://api.openai.com/v1/live/sessions") {
              expect(req.headers.get("authorization")).toBe("Bearer sk-openai")
              expect(JSON.parse(input.text)).toEqual({
                session: { instructions: "Be concise.", voice: "marin", model: "gpt-live-1" },
                transport: { type: "webrtc", sdp: "v=0\r\no=offer\r\n", dcid: 4 },
              })
              return input.respond(
                JSON.stringify({ session: { id: "s1" }, transport: { sdp: "v=0\r\no=live-answer\r\n" } }),
              )
            }
            if (req.url === "https://api.openai.com/v1/realtime/calls?dcid=4") {
              expect(req.headers.get("authorization")).toBe("Bearer sk-openai")
              const boundary = input.text.slice(2, input.text.indexOf("\r\n"))
              const form = yield* Effect.promise(() =>
                new Response(input.text, {
                  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
                }).formData(),
              )
              expect(form.get("sdp")).toBe("v=0\r\no=offer\r\n")
              expect(JSON.parse(String(form.get("session")))).toEqual({
                type: "realtime",
                instructions: "Brief.",
                model: "gpt-realtime-2.1",
              })
              return input.respond("v=0\r\no=rtc-answer\r\n", { headers: { "content-type": "application/sdp" } })
            }
            if (req.url === "https://api.openai.com/v1/realtime/client_secrets") {
              expect(req.headers.get("authorization")).toBe("Bearer sk-openai")
              expect(JSON.parse(input.text)).toEqual({
                expires_after: { anchor: "created_at", seconds: 60 },
                session: { type: "realtime", instructions: "Brief.", model: "gpt-realtime-2.1" },
              })
              return input.respond(JSON.stringify({ value: "ek_1", expires_at: 1760000060 }))
            }
            if (req.url === "https://generativelanguage.googleapis.com/v1beta/auth_tokens") {
              expect(req.headers.get("x-goog-api-key")).toBe("gemini-key")
              expect(req.headers.get("authorization")).toBeNull()
              expect(JSON.parse(input.text)).toEqual({
                uses: 1,
                expireTime: "2025-10-09T09:23:20.000Z",
                newSessionExpireTime: "2025-10-09T08:54:20.000Z",
                bidiGenerateContentSetup: {
                  generationConfig: { responseModalities: ["AUDIO"] },
                  systemInstruction: { parts: [{ text: "Brief." }] },
                  model: "models/gemini-3.8-live",
                },
              })
              return input.respond(JSON.stringify({ name: "auth_tokens/ek_3" }))
            }
            expect(req.url).toBe("https://api.x.ai/v1/realtime/client_secrets")
            expect(req.headers.get("authorization")).toBe("Bearer xai-key")
            expect(JSON.parse(input.text)).toEqual({ expires_after: { seconds: 60 } })
            return input.respond(JSON.stringify({ value: "ek_2", expires_at: 1760000120 }))
          }),
        ),
      ),
    ),
  )

  test("routes bare and versioned model names to their engine", () => {
    expect(Realtime.engines.map((item) => Realtime.engine(item.model)?.id)).toEqual(
      Realtime.engines.map((item) => item.id),
    )
    expect(
      [
        "gpt-realtime",
        "gpt-realtime-2.1",
        "gpt-live",
        "grok-voice-latest",
        "gemini-3.8-live",
        "gemini-3.8-live-extended-thinking",
      ].map((model) => Realtime.engine(model)?.id),
    ).toEqual(["openai-realtime", "openai-realtime", "openai-live", "xai-realtime", "gemini-live", "gemini-live"])
    expect(Realtime.engine("gpt-realtimex")).toBeUndefined()
    expect(Realtime.engine("gemini-3.8-flash")).toBeUndefined()
    expect(Realtime.engine("gemini-3.5-live")).toBeUndefined()
  })

  it.effect("rejects unsupported transports before network I/O", () =>
    Effect.gen(function* () {
      const liveWs = yield* Realtime.connect({
        model: "gpt-live-1",
        apiKey: Redacted.make("k"),
        transport: { type: "websocket" },
      }).pipe(Effect.flip)
      const grokRtc = yield* Realtime.connect({
        model: "grok-voice-3.0",
        apiKey: Redacted.make("k"),
        transport: { type: "webrtc", sdp: "v=0" },
      }).pipe(Effect.flip)
      const geminiRtc = yield* Realtime.connect({
        model: "gemini-3.8-live",
        apiKey: Redacted.make("k"),
        transport: { type: "webrtc", sdp: "v=0" },
      }).pipe(Effect.flip)
      expect([liveWs.reason._tag, grokRtc.reason._tag, geminiRtc.reason._tag]).toEqual([
        "InvalidRequest",
        "InvalidRequest",
        "InvalidRequest",
      ])
    }).pipe(Effect.provide(dynamicResponse(() => Effect.die("unsupported transport reached the network")))),
  )
})
