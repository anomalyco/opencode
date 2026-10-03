let files: Record<string, () => Promise<string>> | undefined
let loads: Record<SoundID, () => Promise<string>> | undefined

function getFiles() {
  if (files) return files
  files = import.meta.glob("../../../ui/src/assets/audio/*.aac", { import: "default" }) as Record<
    string,
    () => Promise<string>
  >
  return files
}

export const SOUND_OPTIONS = [
  { id: "alert-01", label: "sound.option.alert01" },
  { id: "alert-02", label: "sound.option.alert02" },
  { id: "alert-03", label: "sound.option.alert03" },
  { id: "alert-04", label: "sound.option.alert04" },
  { id: "alert-05", label: "sound.option.alert05" },
  { id: "alert-06", label: "sound.option.alert06" },
  { id: "alert-07", label: "sound.option.alert07" },
  { id: "alert-08", label: "sound.option.alert08" },
  { id: "alert-09", label: "sound.option.alert09" },
  { id: "alert-10", label: "sound.option.alert10" },
  { id: "bip-bop-01", label: "sound.option.bipbop01" },
  { id: "bip-bop-02", label: "sound.option.bipbop02" },
  { id: "bip-bop-03", label: "sound.option.bipbop03" },
  { id: "bip-bop-04", label: "sound.option.bipbop04" },
  { id: "bip-bop-05", label: "sound.option.bipbop05" },
  { id: "bip-bop-06", label: "sound.option.bipbop06" },
  { id: "bip-bop-07", label: "sound.option.bipbop07" },
  { id: "bip-bop-08", label: "sound.option.bipbop08" },
  { id: "bip-bop-09", label: "sound.option.bipbop09" },
  { id: "bip-bop-10", label: "sound.option.bipbop10" },
  { id: "staplebops-01", label: "sound.option.staplebops01" },
  { id: "staplebops-02", label: "sound.option.staplebops02" },
  { id: "staplebops-03", label: "sound.option.staplebops03" },
  { id: "staplebops-04", label: "sound.option.staplebops04" },
  { id: "staplebops-05", label: "sound.option.staplebops05" },
  { id: "staplebops-06", label: "sound.option.staplebops06" },
  { id: "staplebops-07", label: "sound.option.staplebops07" },
  { id: "nope-01", label: "sound.option.nope01" },
  { id: "nope-02", label: "sound.option.nope02" },
  { id: "nope-03", label: "sound.option.nope03" },
  { id: "nope-04", label: "sound.option.nope04" },
  { id: "nope-05", label: "sound.option.nope05" },
  { id: "nope-06", label: "sound.option.nope06" },
  { id: "nope-07", label: "sound.option.nope07" },
  { id: "nope-08", label: "sound.option.nope08" },
  { id: "nope-09", label: "sound.option.nope09" },
  { id: "nope-10", label: "sound.option.nope10" },
  { id: "nope-11", label: "sound.option.nope11" },
  { id: "nope-12", label: "sound.option.nope12" },
  { id: "yup-01", label: "sound.option.yup01" },
  { id: "yup-02", label: "sound.option.yup02" },
  { id: "yup-03", label: "sound.option.yup03" },
  { id: "yup-04", label: "sound.option.yup04" },
  { id: "yup-05", label: "sound.option.yup05" },
  { id: "yup-06", label: "sound.option.yup06" },
] as const

export type SoundOption = (typeof SOUND_OPTIONS)[number]
export type SoundID = SoundOption["id"]

function getLoads() {
  if (loads) return loads
  loads = Object.fromEntries(
    Object.entries(getFiles()).flatMap(([path, load]) => {
      const file = path.split("/").at(-1)
      if (!file) return []
      return [[file.replace(/\.aac$/, ""), load] as const]
    }),
  ) as Record<SoundID, () => Promise<string>>
  return loads
}

const cache = new Map<SoundID, Promise<string | undefined>>()

export function soundSrc(id: string | undefined) {
  const loads = getLoads()
  if (!id || !(id in loads)) return Promise.resolve(undefined)
  const key = id as SoundID
  const hit = cache.get(key)
  if (hit) return hit
  const next = loads[key]().catch(() => undefined)
  cache.set(key, next)
  return next
}

export function playSound(src: string | undefined) {
  if (typeof Audio === "undefined") return
  if (!src) return
  const audio = new Audio(src)
  audio.play().catch(() => undefined)
  return () => {
    audio.pause()
    audio.currentTime = 0
  }
}

export const SOUND_COOLDOWN_MS = 2_000

export function createSoundPlayer(input: {
  load: (id: string | undefined) => Promise<string | undefined>
  play: (src: string | undefined) => (() => void) | undefined
  now?: () => number
  cooldownMs?: number
}) {
  const now = input.now ?? Date.now
  const cooldownMs = input.cooldownMs ?? SOUND_COOLDOWN_MS
  let lastPlayedAt = Number.NEGATIVE_INFINITY
  let cleanup: (() => void) | undefined
  let inflight: Promise<(() => void) | undefined> | undefined

  return (id: string | undefined): Promise<(() => void) | undefined> => {
    if (inflight) return inflight
    if (now() - lastPlayedAt < cooldownMs) return Promise.resolve(undefined)
    inflight = input
      .load(id)
      .then((src) => {
        if (!src) return undefined
        lastPlayedAt = now()
        cleanup?.()
        cleanup = input.play(src)
        return cleanup
      })
      .finally(() => {
        inflight = undefined
      })
    return inflight
  }
}

export const playSoundById = createSoundPlayer({ load: soundSrc, play: playSound })

// Settings previews play on explicit user action and must not be throttled.
export const playSoundPreview = createSoundPlayer({ load: soundSrc, play: playSound, cooldownMs: 0 })
