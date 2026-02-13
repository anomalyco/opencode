// Custom iOS-style notification sound for agent completion
import iosSound from "../assets/ios.mp3"

export const SOUND_OPTIONS = [
  { id: "ios", label: "iOS", src: iosSound },
] as const

export type SoundOption = (typeof SOUND_OPTIONS)[number]
export type SoundID = SoundOption["id"]

const soundById = Object.fromEntries(SOUND_OPTIONS.map((s) => [s.id, s.src])) as Record<SoundID, string>

export function soundSrc(id: string | undefined) {
  if (!id) return
  if (!(id in soundById)) return
  return soundById[id as SoundID]
}

export function playSound(src: string | undefined) {
  if (typeof Audio === "undefined") return
  if (!src) return
  const audio = new Audio(src)
  audio.play().catch(() => undefined)

  // Return a cleanup function to pause the sound.
  return () => {
    audio.pause()
    audio.currentTime = 0
  }
}
