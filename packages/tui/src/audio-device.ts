import { readdirSync } from "node:fs"

// ALSA exposes playback hardware as pcmC<card>D<device>p nodes under
// /dev/snd. Mixer-only (controlC0) or capture-only (pcmC0D0c) entries
// cannot play notification sounds. Probing first keeps Audio.create
// (native ALSA init) from dumping diagnostics over the TUI on
// audio-less hosts (Termux, soundless servers).
export function hasAudioPlaybackDevice(
  os: NodeJS.Platform = process.platform,
  readdir: (path: string) => string[] = (path) => readdirSync(path),
) {
  if (os !== "linux") return true
  try {
    return readdir("/dev/snd").some((entry) => /^pcmC\d+D\d+p$/.test(entry))
  } catch {
    return false
  }
}
