import { Audio, type AudioErrorContext, type AudioPlayOptions, type AudioSound } from "@opentui/core"
import { readFile } from "node:fs/promises"

const IDLE_POLL_MS = 250
// Chimes run 0.4-0.7s and notifications arrive in bursts (several subagent_done in one
// second, a question followed by a permission). Releasing only after this many quiet polls
// keeps one burst on a single device session instead of stopping and restarting the stream
// between chimes. A stats read that fails counts as playing so it cannot cut a chime
// short; that bound keeps an engine which stopped reporting from being polled forever.
const IDLE_RELEASE_POLLS = 4
const IDLE_STATS_POLLS = 40

let audio: Audio | null | undefined
const sounds = new Map<string, Promise<AudioSound | null>>()
let cancelIdleWatch: (() => void) | undefined

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
  const current = getAudio()
  if (!current) return null
  if (!current.isStarted() && !current.start()) return null
  const voice = current.play(sound, options)
  if (current.isStarted()) watchUntilIdle(current)
  return voice
}

export function isStarted() {
  return audio?.isStarted() ?? false
}

export function dispose() {
  cancelIdleWatch?.()
  cancelIdleWatch = undefined
  audio?.dispose()
  audio = undefined
  sounds.clear()
}

// A running playback device holds a system-wide sleep assertion while it is
// open (on macOS coreaudiod prevents idle sleep for every process with an
// active audio output), so stop it once the attention sound is over.
// The next play() starts the device again. OpenTUI Audio has no per-voice
// ended event, so finish detection polls the mixer's active voice count.
function watchUntilIdle(current: Audio) {
  cancelIdleWatch?.()
  let quietPolls = 0
  let unreadablePolls = 0

  const timer = setInterval(() => {
    const stats = current.getStats()
    if (stats === null) {
      if (++unreadablePolls < IDLE_STATS_POLLS) return
      clearInterval(timer)
      cancelIdleWatch = undefined
      return
    }
    unreadablePolls = 0
    if (stats.voicesActive > 0) {
      quietPolls = 0
      return
    }
    if (++quietPolls < IDLE_RELEASE_POLLS) return
    clearInterval(timer)
    cancelIdleWatch = undefined
    current.stop()
  }, IDLE_POLL_MS)
  timer.unref()
  cancelIdleWatch = () => clearInterval(timer)
}
