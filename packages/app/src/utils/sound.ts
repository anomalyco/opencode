import nope01 from "@opencode-ai/ui/audio/nope-01.aac"
import nope02 from "@opencode-ai/ui/audio/nope-02.aac"
import nope03 from "@opencode-ai/ui/audio/nope-03.aac"
import nope04 from "@opencode-ai/ui/audio/nope-04.aac"
import nope05 from "@opencode-ai/ui/audio/nope-05.aac"
import staplebops01 from "@opencode-ai/ui/audio/staplebops-01.aac"
import staplebops02 from "@opencode-ai/ui/audio/staplebops-02.aac"
import staplebops03 from "@opencode-ai/ui/audio/staplebops-03.aac"
import staplebops04 from "@opencode-ai/ui/audio/staplebops-04.aac"
import staplebops05 from "@opencode-ai/ui/audio/staplebops-05.aac"
import staplebops06 from "@opencode-ai/ui/audio/staplebops-06.aac"
import staplebops07 from "@opencode-ai/ui/audio/staplebops-07.aac"

export const SOUND_OPTIONS = [
  { id: "staplebops-01", label: "Boopy", src: staplebops01 },
  { id: "staplebops-02", label: "Beepy", src: staplebops02 },
  { id: "staplebops-03", label: "Staplebops 03", src: staplebops03 },
  { id: "staplebops-04", label: "Staplebops 04", src: staplebops04 },
  { id: "staplebops-05", label: "Staplebops 05", src: staplebops05 },
  { id: "staplebops-06", label: "Staplebops 06", src: staplebops06 },
  { id: "staplebops-07", label: "Staplebops 07", src: staplebops07 },
  { id: "nope-01", label: "Nope 01", src: nope01 },
  { id: "nope-02", label: "Nope 02", src: nope02 },
  { id: "nope-03", label: "Oopsie", src: nope03 },
  { id: "nope-04", label: "Nope 04", src: nope04 },
  { id: "nope-05", label: "Nope 05", src: nope05 },
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
  void new Audio(src).play().catch(() => undefined)
}
