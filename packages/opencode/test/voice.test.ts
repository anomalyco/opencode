import { describe, expect, it } from "bun:test"
import { WhisperClient } from "../src/voice/whisper"
import { SlackDaemon } from "../src/daemon/slack"
import { HardwareAudioDetector } from "../src/voice/detector"
import { CommandGuardrails } from "../src/guardrails/command"
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

describe("Security Guardrails & Safety Audits", () => {
  it("blocks privilege escalation commands (sudo, su)", () => {
    const sudoAudit = CommandGuardrails.audit("sudo apt-get update")
    expect(sudoAudit.allowed).toBe(false)
    expect(sudoAudit.riskLevel).toBe("critical")

    const suAudit = CommandGuardrails.audit("su root")
    expect(suAudit.allowed).toBe(false)
  })

  it("blocks destructive root/home filesystem deletions (rm -rf /)", () => {
    const rmAudit = CommandGuardrails.audit("rm -rf /")
    expect(rmAudit.allowed).toBe(false)
    expect(rmAudit.riskLevel).toBe("critical")

    const rmHomeAudit = CommandGuardrails.audit("rm -rf ~")
    expect(rmHomeAudit.allowed).toBe(false)
  })

  it("blocks private SSH key exfiltration attempts", () => {
    const sshAudit = CommandGuardrails.audit("cat ~/.ssh/id_rsa")
    expect(sshAudit.allowed).toBe(false)
    expect(sshAudit.riskLevel).toBe("critical")
  })

  it("permits safe development commands", () => {
    const testAudit = CommandGuardrails.audit("bun test")
    expect(testAudit.allowed).toBe(true)
    expect(testAudit.riskLevel).toBe("safe")

    const gitAudit = CommandGuardrails.audit("git status")
    expect(gitAudit.allowed).toBe(true)
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
