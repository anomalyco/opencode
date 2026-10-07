import { expect, test } from "bun:test"
import {
  supportsManagedVoice,
  validVoiceProvider,
  voiceAdapter,
  voiceCapabilities,
  voiceRequestLanguage,
  type VoiceProviderConfig,
} from "./types"

const provider: VoiceProviderConfig = {
  id: "speech",
  name: "Speech",
  baseURL: "https://speech.example/v1",
  models: [{ id: "asr", name: "ASR", visible: true }],
}

test("legacy providers resolve without changing their saved configuration", () => {
  expect(voiceAdapter(provider)).toBe("transcription-api")
  expect(voiceAdapter({ ...provider, protocol: "ollama" })).toBe("ollama-qwen")
  expect(voiceAdapter()).toBe("mlx-qwen")
  expect(provider.adapter).toBeUndefined()
})

test("external transcription has unknown languages until the model declares them", () => {
  expect(voiceCapabilities(provider, "asr").language).toBe("unknown")
  expect(voiceRequestLanguage(voiceCapabilities(provider, "asr"), "ja")).toBe("ja")
  const configured = { ...provider, models: [{ ...provider.models[0]!, languages: ["ja", "fr"] }] }
  expect(voiceCapabilities(configured, "asr").languages).toEqual(["ja", "fr"])
  expect(voiceRequestLanguage(voiceCapabilities(configured, "asr"), "ko")).toBe("auto")
  expect(voiceRequestLanguage(voiceCapabilities(configured, "asr"), "ja")).toBe("ja")
  expect(voiceRequestLanguage(voiceCapabilities(configured, "asr"), "fr")).toBe("fr")
  expect(voiceRequestLanguage(voiceCapabilities(provider), "invalid input")).toBe("auto")
})

test("Qwen Ollama applies the General language without narrowing its supported languages to model metadata", () => {
  const configured: VoiceProviderConfig = {
    ...provider,
    adapter: "ollama-qwen",
    models: [{ ...provider.models[0]!, languages: ["ko"] }],
  }
  expect(voiceCapabilities(configured, "asr").language).toBe("selectable")
  expect(voiceRequestLanguage(voiceCapabilities(configured, "asr"), "ko")).toBe("ko")
  expect(voiceRequestLanguage(voiceCapabilities(configured, "asr"), "ja")).toBe("ja")
})

test.each([
  ["darwin", "arm64", true],
  ["darwin", "x64", false],
  ["win32", "x64", false],
  ["win32", "arm64", false],
  ["linux", "x64", false],
  ["linux", "arm64", false],
  ["unknown", "unknown", false],
])("managed MLX availability on %s %s does not gate external providers", (platform, arch, supported) => {
  expect(supportsManagedVoice({ platform, arch })).toBe(supported)
  expect(validVoiceProvider({ ...provider, location: "remote" })).toBe(true)
})

test("rejects conflicting adapter contracts and invalid language metadata", () => {
  expect(validVoiceProvider({ ...provider, protocol: "openai", adapter: "ollama-qwen" })).toBe(false)
  expect(validVoiceProvider({ ...provider, models: [{ ...provider.models[0]!, languages: ["bad language"] }] })).toBe(
    false,
  )
  expect(validVoiceProvider({ ...provider, adapter: "transcription-api", location: "cloud" })).toBe(true)
})
