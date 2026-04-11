import type { Config } from "@/config/config"

export const resolveType = (voice?: Config.Info["voice"]) => {
  if (voice?.type) return voice.type
  if (voice?.whisper?.apiKey && !voice?.alm?.apiKey) return "whisper"
  if (voice?.alm?.apiKey && !voice?.whisper?.apiKey) return "alm"
  if (voice?.whisper?.apiKey) return "whisper"
  if (voice?.alm?.apiKey) return "alm"
  return "whisper"
}
