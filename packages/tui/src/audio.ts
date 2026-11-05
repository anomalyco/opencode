import { Audio, type AudioErrorContext, type AudioPlayOptions, type AudioSound } from "@opentui/core"
import { readFile } from "node:fs/promises"

let audio: Audio | null | undefined
// Once the backend fails to start there is nothing to recover by probing
// again: a second attempt reprints the backend diagnostics without a device
// to bind. The flag stays until dispose().
let unavailable = false
const sounds = new Map<string, Promise<AudioSound | null>>()

function getAudio() {
  if (audio !== undefined) return audio
  try {
    const next = Audio.create({ autoStart: false })
    next.on("error", (error: Error, context: AudioErrorContext) => {
      console.debug("tui audio error", { error, context })
    })
    audio = next
    return next
  } catch (error) {
    console.debug("failed to create tui audio", { error })
    audio = null
    return null
  }
}

export function loadSoundFile(file: string) {
  if (unavailable) return Promise.resolve(null)
  const current = getAudio()
  if (!current) return Promise.resolve(null)
  const cached = sounds.get(file)
  if (cached) return cached
  const task = readFile(file)
    .then((bytes) => current.loadSound(bytes))
    .catch((error) => {
      console.debug("failed to load tui sound", { file, error })
      return null
    })
  sounds.set(file, task)
  return task
}

export function play(sound: AudioSound, options?: AudioPlayOptions) {
  if (unavailable) return null
  const current = getAudio()
  if (!current) return null
  if (!current.isStarted() && !current.start()) {
    unavailable = true
    current.dispose()
    audio = null
    sounds.clear()
    return null
  }
  return current.play(sound, options)
}

export function dispose() {
  unavailable = false
  audio?.dispose()
  audio = undefined
  sounds.clear()
}
