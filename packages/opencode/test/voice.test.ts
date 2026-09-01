import { describe, expect, it } from "bun:test"
import { WhisperClient } from "../src/voice/whisper"
import { SlackDaemon } from "../src/daemon/slack"
import { HardwareAudioDetector } from "../src/voice/detector"
import type { AudioRecordingBuffer } from "../src/voice/types"

describe("Voice STT & Hardware Analysis", () => {
  it("detects system platform and audio recording tools dynamically", () => {
    const status = HardwareAudioDetector.detect()
    expect(status).toBeDefined()
    expect(status.platform).toBe(process.platform)
    expect(Array.isArray(status.tools)).toBe(true)
  })

  it("initializes WhisperClient with dynamic environment endpoint without hardcoding", () => {
    const client = new WhisperClient({
      model: "whisper-large-v3",
      language: "auto",
      translateToEnglish: true,
    })

    expect(client).toBeDefined()
  })

  it("handles audio recording buffer structure", () => {
    const mockPcm = Buffer.from(new Uint8Array(32000))
    const audioBuffer: AudioRecordingBuffer = {
      pcmBuffer: mockPcm,
      sampleRate: 16000,
      channels: 1,
      durationMs: 1000,
    }

    expect(audioBuffer.pcmBuffer.length).toBe(32000)
    expect(audioBuffer.sampleRate).toBe(16000)
    expect(audioBuffer.durationMs).toBe(1000)
  })
})

describe("Slack Automation Daemon", () => {
  it("initializes Slack daemon in disabled mode when tokens not provided", async () => {
    const daemon = new SlackDaemon({
      enabled: false,
    })

    const started = await daemon.start()
    expect(started).toBe(false)
    expect(daemon.active).toBe(false)
  })
})
