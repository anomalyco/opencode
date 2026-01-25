import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"

describe("realtime.config", () => {
  describe("RealtimeConfig schema", () => {
    test("validates minimal realtime config", () => {
      const config = Config.Info.parse({
        experimental: {
          realtime: {
            enabled: true,
          },
        },
      })
      expect(config.experimental?.realtime?.enabled).toBe(true)
    })

    test("validates realtime config with voice setting", () => {
      const config = Config.Info.parse({
        experimental: {
          realtime: {
            enabled: true,
            voice: "alloy",
          },
        },
      })
      expect(config.experimental?.realtime?.voice).toBe("alloy")
    })

    test("validates realtime config with all VAD settings", () => {
      const config = Config.Info.parse({
        experimental: {
          realtime: {
            enabled: true,
            voice: "echo",
            vad: {
              threshold: 0.6,
              prefix_padding_ms: 400,
              silence_duration_ms: 600,
            },
          },
        },
      })
      expect(config.experimental?.realtime?.vad?.threshold).toBe(0.6)
      expect(config.experimental?.realtime?.vad?.prefix_padding_ms).toBe(400)
      expect(config.experimental?.realtime?.vad?.silence_duration_ms).toBe(600)
    })

    test("validates realtime config with input/output audio format", () => {
      const config = Config.Info.parse({
        experimental: {
          realtime: {
            enabled: true,
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
          },
        },
      })
      expect(config.experimental?.realtime?.input_audio_format).toBe("pcm16")
      expect(config.experimental?.realtime?.output_audio_format).toBe("pcm16")
    })

    test("validates all OpenAI voice options", () => {
      const voices = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const
      for (const voice of voices) {
        const config = Config.Info.parse({
          experimental: {
            realtime: {
              enabled: true,
              voice,
            },
          },
        })
        expect(config.experimental?.realtime?.voice).toBe(voice)
      }
    })

    test("rejects invalid voice option", () => {
      expect(() =>
        Config.Info.parse({
          experimental: {
            realtime: {
              enabled: true,
              voice: "invalid_voice",
            },
          },
        }),
      ).toThrow()
    })

    test("validates realtime config with turn detection mode", () => {
      const config = Config.Info.parse({
        experimental: {
          realtime: {
            enabled: true,
            turn_detection: "server_vad",
          },
        },
      })
      expect(config.experimental?.realtime?.turn_detection).toBe("server_vad")
    })

    test("validates disabled turn detection (push-to-talk)", () => {
      const config = Config.Info.parse({
        experimental: {
          realtime: {
            enabled: true,
            turn_detection: "none",
          },
        },
      })
      expect(config.experimental?.realtime?.turn_detection).toBe("none")
    })

    test("defaults are not applied at schema level", () => {
      const config = Config.Info.parse({
        experimental: {
          realtime: {
            enabled: true,
          },
        },
      })
      // Schema should not enforce defaults - that's done at runtime
      expect(config.experimental?.realtime?.voice).toBeUndefined()
      expect(config.experimental?.realtime?.vad).toBeUndefined()
    })
  })
})
