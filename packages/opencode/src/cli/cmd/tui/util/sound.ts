import { Player } from "cli-sound"
import { Process } from "@/util/process"
import { which } from "@/util/which"
import pulseA from "../asset/pulse-a.wav" with { type: "file" }
import pulseB from "../asset/pulse-b.wav" with { type: "file" }
import pulseC from "../asset/pulse-c.wav" with { type: "file" }
import charge from "../asset/charge.wav" with { type: "file" }

const FILE = [pulseA, pulseB, pulseC]

const HUM = charge

const LIST = [
  "ffplay",
  "mpv",
  "mpg123",
  "mpg321",
  "mplayer",
  "afplay",
  "play",
  "omxplayer",
  "aplay",
  "cmdmp3",
  "cvlc",
  "powershell.exe",
] as const

type Kind = (typeof LIST)[number]

function args(kind: Kind, file: string, volume: number) {
  if (kind === "ffplay") return [kind, "-autoexit", "-nodisp", "-af", `volume=${volume}`, file]
  if (kind === "mpv")
    return [kind, "--no-video", "--audio-display=no", "--volume", String(Math.round(volume * 100)), file]
  if (kind === "mpg123" || kind === "mpg321") return [kind, "-g", String(Math.round(volume * 100)), file]
  if (kind === "mplayer") return [kind, "-vo", "null", "-volume", String(Math.round(volume * 100)), file]
  if (kind === "afplay" || kind === "omxplayer" || kind === "aplay" || kind === "cmdmp3") return [kind, file]
  if (kind === "play") return [kind, "-v", String(volume), file]
  if (kind === "cvlc") return [kind, `--gain=${volume}`, "--play-and-exit", file]
  return [kind, "-c", `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`]
}

export namespace Sound {
  let item: Player | null | undefined
  let kind: Kind | null | undefined
  let proc: Process.Child | undefined
  let tail: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  let shot = 0

  function load() {
    if (item !== undefined) return item
    try {
      item = new Player({ volume: 0.35 })
    } catch {
      item = null
    }
    return item
  }

  function pick() {
    if (kind !== undefined) return kind
    kind = LIST.find((item) => which(item)) ?? null
    return kind
  }

  function run(file: string, volume: number) {
    const kind = pick()
    if (!kind) return
    return Process.spawn(args(kind, file, volume), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
  }

  function clear() {
    if (!tail) return
    clearTimeout(tail)
    tail = undefined
  }

  function play(file: string, volume: number) {
    const item = load()
    if (!item) return run(file, volume)?.exited
    return item.play(file, { volume }).catch(() => run(file, volume)?.exited)
  }

  export function start() {
    stop()
    const id = ++seq
    const next = run(HUM, 0.24)
    if (!next) return
    proc = next
    void next.exited.then(
      () => {
        if (id !== seq) return
        if (proc === next) proc = undefined
      },
      () => {
        if (id !== seq) return
        if (proc === next) proc = undefined
      },
    )
  }

  export function stop(delay = 0) {
    seq++
    clear()
    if (!proc) return
    const next = proc
    if (delay <= 0) {
      proc = undefined
      void Process.stop(next).catch(() => undefined)
      return
    }
    tail = setTimeout(() => {
      tail = undefined
      if (proc === next) proc = undefined
      void Process.stop(next).catch(() => undefined)
    }, delay)
  }

  export function pulse(scale = 1) {
    stop(140)
    const file = FILE[shot++ % FILE.length]
    void Promise.resolve(play(file, 0.26 + 0.14 * scale)).catch(() => undefined)
  }

  export function dispose() {
    stop()
  }
}
