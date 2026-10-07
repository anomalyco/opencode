import { useVoice } from "@/context/voice"
import { voiceWav } from "@/voice/audio"
import type { VoiceResult } from "@/voice/types"

export function createVoiceTranscriber(onText: (text: string) => void) {
  const voice = useVoice()
  return async (audio: Blob, signal: AbortSignal): Promise<VoiceResult<void>> => {
    const model = voice.selected()
    if (!model) return { ok: false, error: "configuration" }
    const id = crypto.randomUUID()
    const cancel = () => void voice.cancel(id)
    signal.addEventListener("abort", cancel, { once: true })
    try {
      const wav = await voiceWav(audio)
      if (signal.aborted) return { ok: false, error: "cancelled" }
      const result = await voice.transcribe({
        id,
        selection: { providerID: model.providerID, modelID: model.id },
        audio: wav,
        language: voice.config.language,
      })
      if (signal.aborted) return { ok: false, error: "cancelled" }
      if (!result.ok) return result
      onText(result.value)
      return { ok: true, value: undefined }
    } catch {
      return { ok: false, error: signal.aborted ? "cancelled" : "audio" }
    } finally {
      signal.removeEventListener("abort", cancel)
    }
  }
}
