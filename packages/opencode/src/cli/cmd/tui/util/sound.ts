import { Player } from "cli-sound"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { which } from "@/util/which"

const FILE = [
  join(tmpdir(), "opencode-pulse-a-v7.wav"),
  join(tmpdir(), "opencode-pulse-b-v7.wav"),
  join(tmpdir(), "opencode-pulse-c-v7.wav"),
]
const HUM = join(tmpdir(), "opencode-charge-v4.wav")
const RATE = 44_100
const TIME = 1
const SPAN = 3.35

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

function pcm(time: number, fill: (t: number, i: number) => readonly [number, number]) {
  const size = Math.floor(RATE * time)
  const bytes = size * 4
  const out = Buffer.alloc(44 + bytes)
  out.write("RIFF", 0)
  out.writeUInt32LE(36 + bytes, 4)
  out.write("WAVE", 8)
  out.write("fmt ", 12)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(2, 22)
  out.writeUInt32LE(RATE, 24)
  out.writeUInt32LE(RATE * 4, 28)
  out.writeUInt16LE(4, 32)
  out.writeUInt16LE(16, 34)
  out.write("data", 36)
  out.writeUInt32LE(bytes, 40)

  for (let i = 0; i < size; i++) {
    const [left, right] = fill(i / RATE, i)
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left)) * 0x7fff), 44 + i * 4)
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right)) * 0x7fff), 46 + i * 4)
  }

  return out
}

function wav(mode: number) {
  let p0 = 0
  let p1 = 0
  let p2 = 0
  let p3 = 0
  const lift = [1, 1.06, 0.95][mode]
  const spread = [1.48, 1.62, 1.38][mode]
  const edge = [2.18, 2.02, 1.9][mode]
  const ring = [0.74, 0.82, 0.68][mode]
  const ping = [0.5, 0.58, 0.44][mode]
  const tail = [1.55, 1.65, 1.45][mode]
  const root = [110, 122, 100][mode]
  const top = [0.05, 0.04, 0.06][mode]
  const wide = [0.06, 0.05, 0.08][mode]
  return pcm(TIME, (t, i) => {
    const attack = Math.min(1, t / 0.0035)
    const body = Math.exp(-t * (8.8 + mode * 0.32))
    const fade = Math.exp(-t * tail)
    const bloom = 0.76 + 0.24 * Math.sin(Math.min(1, t / 0.04) * Math.PI * 0.5)
    const env = attack * body * bloom
    const trail = Math.max(0, t - [0.08, 0.075, 0.1][mode])
    const hang = (1 - Math.exp(-trail * [14, 16, 12][mode])) * Math.exp(-trail * [1.45, 1.32, 1.58][mode])
    const end = t < TIME - 0.28 ? 1 : ((TIME - t) / 0.28) ** 2 * (3 - 2 * ((TIME - t) / 0.28))
    const drop = Math.exp(-t * (9.4 - mode * 0.35))
    const f0 = (320 * drop + root) * lift
    const f1 = f0 * spread
    const f2 = f0 * edge
    const f3 = 32 + 13 * Math.exp(-t * 12)
    const mod = Math.sin(p2 * 0.5 + 0.4) * Math.exp(-t * 24) * 1.6
    const n = Math.sin((i * 12.9898 + 78.233) * 0.017) * 43758.5453
    const dust = (n - Math.floor(n) - 0.5) * Math.exp(-t * 85)
    p0 += (Math.PI * 2 * (f0 + mod * 90)) / RATE
    p1 += (Math.PI * 2 * f1) / RATE
    p2 += (Math.PI * 2 * f2) / RATE
    p3 += (Math.PI * 2 * f3) / RATE
    const low = Math.sin(p3 + Math.sin(p0) * 0.12) * 0.34
    const core = Math.sin(p0) * 0.72 + Math.sin(p1 + 0.16) * 0.1 + Math.sin(p2 + 0.32) * 0.03 + low
    const chime = Math.sin(p1 * 0.96 + Math.sin(p2) * 0.1) * Math.exp(-t * 14) * 0.025
    const snap = Math.sin(p2 * 1.24 + 0.3) * Math.exp(-t * 26) * 0.02
    const boom = Math.sin(p3 * 0.82 + Math.sin(p0) * 0.08) * Math.exp(-t * 8.5) * 0.24
    const ringed = Math.sin(p1 * ring + Math.sin(p0) * 0.16 + 0.35) * Math.exp(-Math.max(0, t - 0.03) * 2.8) * top
    const pinged = Math.sin(p2 * ping + 0.8) * hang * (wide + 0.04)
    const glass = (Math.sin(p1 * 0.31 + 1.1) * 0.7 + Math.sin(p2 * 0.27 + 0.4) * 0.3) * hang * 0.05
    const room =
      (Math.sin(p0 * 0.27 + 0.8) * 0.24 + Math.sin(p1 * 0.21 + 0.35) * 0.46 + Math.sin(p2 * 0.18 + 1.2) * 0.3) *
      hang *
      0.12
    const sig = Math.tanh((core * env + chime + snap + boom + ringed + pinged + glass + room + dust * 0.07) * 1.48)
    const echo = (sig * 0.46 + boom * 0.42 + pinged * 0.22 + room * 0.9) * fade * 0.22
    const left = (sig + Math.sin(p1 * 0.996 + 0.18) * fade * 0.01 + echo * 0.58 + glass * 0.08 + room * 0.14) * end
    const right =
      (sig + Math.sin(p1 * 1.004 + 0.56) * fade * 0.01 + echo + pinged * 0.05 + glass * 0.1 + room * 0.16) * end
    return [left, right] as const
  })
}

function hum() {
  let p0 = 0
  let p1 = 0
  let p2 = 0
  let p3 = 0
  return pcm(SPAN, (t, i) => {
    const rise = Math.max(0, Math.min(1, t / 3))
    const fade = Math.max(0, Math.min(1, (SPAN - t) / 0.22))
    const attack = Math.min(1, t / 0.05)
    const body = rise * rise * (3 - 2 * rise)
    const climb = body * body
    const tip = climb * climb
    const env = attack * fade * (0.12 + (0.56 - 0.12) * body)
    const wobble = 1 + Math.sin(Math.PI * 2 * 3.2 * t) * 0.012
    const f0 =
      (72 + body * 92 + climb * 96 + tip * 86 + Math.sin(Math.PI * 2 * (0.72 + climb * 1.9) * t) * 1.8) * wobble
    const f1 = f0 * (1.88 + climb * 0.14)
    const f2 = f0 * (2.68 + climb * 0.32 + tip * 0.12)
    const f3 = 220 + body * 360 + climb * 440 + tip * 180
    p0 += (Math.PI * 2 * f0) / RATE
    p1 += (Math.PI * 2 * f1) / RATE
    p2 += (Math.PI * 2 * f2) / RATE
    p3 += (Math.PI * 2 * f3) / RATE
    const core = Math.sin(p0) * 0.66 + Math.sin(p1 + Math.sin(p0) * 0.22) * 0.14 + Math.sin(p2 + 0.2) * 0.06
    const air = Math.sin(p3 + Math.sin(p1) * 0.5) * (0.02 + climb * 0.08)
    const grit = Math.sin((i * 7.173 + 19.17) * 0.013) * 43758.5453
    const dust = (grit - Math.floor(grit) - 0.5) * body * 0.01
    const sig = Math.tanh((core + air + dust) * env * (1.72 + climb * 0.22))
    const left = sig + Math.sin(p1 * 0.998 + 0.1) * (0.01 + climb * 0.018)
    const right = sig + Math.sin(p1 * 1.002 + 0.5) * (0.01 + climb * 0.018)
    return [left, right] as const
  })
}

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
  let file: Promise<string[]> | undefined
  let loop: Promise<string> | undefined
  let item: Player | null | undefined
  let kind: Kind | null | undefined
  let proc: Process.Child | undefined
  let tail: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  let shot = 0

  function tone() {
    if (file) return file
    file = (async () => {
      await Promise.all(
        FILE.map(async (file, i) => {
          if (!(await Filesystem.exists(file))) await Filesystem.write(file, wav(i))
        }),
      )
      return FILE
    })()
    return file
  }

  function rise() {
    if (loop) return loop
    loop = (async () => {
      if (!(await Filesystem.exists(HUM))) await Filesystem.write(HUM, hum())
      return HUM
    })()
    return loop
  }

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

  export function start() {
    stop()
    const id = ++seq
    void rise().then((file) => {
      if (id !== seq) return
      const next = run(file, 0.24)
      if (!next) return
      proc = next
      void next.exited.then(
        () => {
          if (proc === next) proc = undefined
        },
        () => {
          if (proc === next) proc = undefined
        },
      )
    })
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

  export function pulse() {
    stop(140)
    const item = load()
    void tone()
      .then((list) => {
        const file = list[shot++ % list.length]
        if (!item) return run(file, 0.4)?.exited
        return item.play(file, { volume: 0.4 }).catch(() => run(file, 0.4)?.exited)
      })
      .catch(() => undefined)
  }

  export function dispose() {
    stop()
  }
}
