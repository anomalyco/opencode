import React, { useState } from "react"
import { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { DialogPrompt, DialogSelect } from "../src/cli/cmd/tui/ui/dialog"

// Speech-to-text provider options
type Provider = "Whisper (OpenAI)" | "ElevenLabs" | "Sarvam AI"
const PROVIDERS: Provider[] = ["Whisper (OpenAI)", "ElevenLabs", "Sarvam AI"]

const PROVIDER_KEYS: Record<Provider, string> = {
  "Whisper (OpenAI)": "openai_api_key",
  "ElevenLabs": "elevenlabs_api_key",
  "Sarvam AI": "sarvam_ai_api_key",
}

// Helper to store settings (in user profile/config)
function loadUserConfig(api: TuiPluginApi) {
  return PROVIDERS.reduce((acc, provider) => {
    acc[provider] = api.local.get(PROVIDER_KEYS[provider]) || ""
    return acc
  }, {} as Record<Provider, string>)
}
function saveUserConfig(api: TuiPluginApi, cfg: Record<Provider, string>) {
  PROVIDERS.forEach(provider => {
    api.local.set(PROVIDER_KEYS[provider], cfg[provider])
  })
}

// UI dialog for selecting provider & inputting an API key
async function showMicSettingsDialog(api: TuiPluginApi) {
  const currentConfig = loadUserConfig(api)
  const { provider = PROVIDERS[0] } = (await DialogSelect.show(api.dialog, "Select Speech-to-Text Provider", PROVIDERS)) || {}
  if (!provider) return
  const { apiKey = "" } = (await DialogPrompt.show(api.dialog, `Enter API Key for ${provider}`, currentConfig[provider])) || {}
  if (apiKey) {
    currentConfig[provider] = apiKey
    saveUserConfig(api, currentConfig)
    api.toast.info({ title: "API key saved", message: `${provider} key updated!` })
  }
}

// Main microphone plugin command
const MicPlugin: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "mic.open",
        title: "Start Microphone Input (STT)...",
        category: "Prompt",
        run: () => showMicDialog(api),
      },
      {
        name: "mic.config",
        title: "Configure Microphone (STT) Providers",
        category: "Prompt",
        run: () => showMicSettingsDialog(api),
      },
    ],
  })

  api.ui.Slot.addToToolbar({
    icon: "🎤",
    tooltip: "Voice-to-Text Prompt",
    onClick: () => showMicDialog(api),
  })
}

// Main STT invocation dialog
async function showMicDialog(api: TuiPluginApi) {
  const currentConfig = loadUserConfig(api)
  const { provider = PROVIDERS[0] } = (await DialogSelect.show(api.dialog, "Select Speech-to-Text Provider", PROVIDERS)) || {}
  if (!provider) return
  const apiKey = currentConfig[provider]
  if (!apiKey) {
    api.toast.warning({ title: "Missing API key", message: `No API key set for ${provider}` })
    return showMicSettingsDialog(api)
  }
  api.toast.info({ title: "Listening...", message: "Start speaking. Press Enter to stop." })
  // TODO: microphone recording impl and stream to backend
  // For now, simulate STT for demo
  const { transcript = "(Simulated speech-to-text result)" } = (await DialogPrompt.show(api.dialog, "Speak now (simulated)", "")) || {}
  if (transcript) {
    // Insert result as prompt
    api.app.appendPrompt({ content: transcript })
  }
}

export default MicPlugin
