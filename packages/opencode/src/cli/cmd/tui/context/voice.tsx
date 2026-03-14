import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { GroqVoice, OpenAIVoice, AudioRecorder } from "@/voice"
import type { VoiceProvider } from "@/voice"
import { Config } from "@/config/config"

export const { use: useVoice, provider: VoiceContextProvider } = createSimpleContext({
  name: "Voice",
  init: () => {
    const [store, setStore] = createStore<{
      isRecording: boolean
      isProcessing: boolean
      error: string | null
      provider: VoiceProvider.Provider | null
      model: string | null
      lastTranscription: string
    }>({
      isRecording: false,
      isProcessing: false,
      error: null,
      provider: null,
      model: null,
      lastTranscription: "",
    })

    const recorder = AudioRecorder.create()

    async function initProvider() {
      try {
        const config = await Config.get()
        const voiceConfig = config.voice
        const providerType = voiceConfig?.provider ?? "groq"
        const model = voiceConfig?.model

        let provider: VoiceProvider.Provider
        if (providerType === "openai") {
          provider = await OpenAIVoice.create()
        } else {
          provider = await GroqVoice.create()
        }

        const available = await provider.isAvailable()
        if (!available) {
          setStore("error", `${provider.name} not configured. Run /connect ${providerType}`)
          return
        }

        setStore("provider", provider)
        setStore("model", model ?? null)
      } catch (e) {
        setStore("error", String(e))
      }
    }

    let providerInitialized = false

    async function ensureProvider() {
      if (providerInitialized) return
      providerInitialized = true
      await initProvider()
    }

    return {
      get isRecording() {
        return store.isRecording
      },
      get isProcessing() {
        return store.isProcessing
      },
      get error() {
        return store.error
      },
      get lastTranscription() {
        return store.lastTranscription
      },
      get isAvailable() {
        return store.provider !== null
      },
      get providerName() {
        return store.provider?.name ?? null
      },
      get model() {
        return store.model
      },
      async startRecording() {
        await ensureProvider()
        if (!store.provider) {
          setStore("error", "Voice provider not available. Run /voice to configure")
          return
        }
        try {
          recorder.start()
          setStore("isRecording", true)
          setStore("error", null)
        } catch (e) {
          setStore("error", `Failed to start recording: ${e}`)
        }
      },
      async stopRecording() {
        if (!store.provider) {
          setStore("error", "Voice provider not available")
          return ""
        }
        setStore("isRecording", false)
        setStore("isProcessing", true)

        try {
          const audio = await recorder.stop()
          if (audio.length === 0) {
            setStore("error", "No audio recorded")
            return ""
          }
          const result = await store.provider.transcribe(audio, {
            model: store.model ?? undefined,
          })
          setStore("lastTranscription", result.text)
          return result.text
        } catch (e) {
          setStore("error", String(e))
          return ""
        } finally {
          setStore("isProcessing", false)
        }
      },
      async toggle() {
        if (store.isRecording) {
          return this.stopRecording()
        } else {
          await this.startRecording()
          return ""
        }
      },
      clearError() {
        setStore("error", null)
      },
      async reinit() {
        await initProvider()
      },
    }
  },
})
