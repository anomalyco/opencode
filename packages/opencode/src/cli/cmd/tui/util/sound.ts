import { Player } from "cli-sound"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { which } from "@/util/which"

const FILE = join(tmpdir(), "opencode-pulse-v7.wav")
const HUM = join(tmpdir(), "opencode-charge-v3.wav")
const RATE = 44_100
const TIME = 0.34
const SPAN = 4
const FULL = 2

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

function clamp(n: number) {
  return Math.max(-1, Math.min(1, n))
}

function pcm(time: number, fill: (t: number, i: number) => readonly [number, number]) {
  const size = Math.floor(RATE * time)
  const channels = 2
  const bytes = size * channels * 2
  const out = Buffer.alloc(44 + bytes)
  out.write("RIFF", 0)
  out.writeUInt32LE(36 + bytes, 4)
  out.write("WAVE", 8)
  out.write("fmt ", 12)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(channels, 22)
  out.writeUInt32LE(RATE, 24)
  out.writeUInt32LE(RATE * channels * 2, 28)
  out.writeUInt16LE(channels * 2, 32)
  out.writeUInt16LE(16, 34)
  out.write("data", 36)
  out.writeUInt32LE(bytes, 40)

  for (let i = 0; i < size; i++) {
    const [left, right] = fill(i / RATE, i)
    out.writeInt16LE(Math.round(clamp(left) * 0x7fff), 44 + i * 4)
    out.writeInt16LE(Math.round(clamp(right) * 0x7fff), 46 + i * 4)
  }

  return out
}

function wav() {
  let p0 = 0
  let p1 = 0
  let p2 = 0
  let p3 = 0
  let p4 = 0
  let p5 = 0
  return pcm(TIME, (t, i) => {
    const attack = Math.min(1, t / 0.004)
    const join = Math.max(0, Math.min(1, (t - 0.035) / 0.05))
    const mix = join * join * (3 - 2 * join)
    const body = Math.exp(-Math.max(0, t - 0.025) * 10.5)
    const tail = Math.exp(-Math.max(0, t - 0.05) * 8.5)
    const bloom = 0.76 + 0.24 * Math.sin(Math.min(1, t / 0.045) * Math.PI * 0.5)
    const env = attack * body * bloom
    const drop = Math.exp(-Math.max(0, t - 0.03) * 10)
    const f0 = 1180 * drop + 360
    const f1 = f0 * 1.5
    const f2 = f0 * 2.01
    const f3 = 160 + 60 * Math.exp(-t * 18)
    const h0 = 180 - t * 65
    const h1 = h0 * 1.96
    const mod = Math.sin(p2 * 0.5 + 0.4) * Math.exp(-t * 24) * 1.6
    const n = Math.sin((i * 12.9898 + 78.233) * 0.017) * 43758.5453
    const dust = (n - Math.floor(n) - 0.5) * Math.exp(-t * 85)
    p0 += (Math.PI * 2 * (f0 + mod * 90)) / RATE
    p1 += (Math.PI * 2 * f1) / RATE
    p2 += (Math.PI * 2 * f2) / RATE
    p3 += (Math.PI * 2 * f3) / RATE
    p4 += (Math.PI * 2 * h0) / RATE
    p5 += (Math.PI * 2 * h1) / RATE
    const hum = (Math.sin(p4) * 0.68 + Math.sin(p5 + 0.2) * 0.18 + Math.sin(p3 * 0.6) * 0.05) * Math.exp(-t * 11)
    const core = Math.sin(p0) * 0.58 + Math.sin(p1 + 0.16) * 0.18 + Math.sin(p2 + 0.32) * 0.08 + Math.sin(p3) * 0.16
    const chime = Math.sin(p1 * 1.01 + Math.sin(p2) * 0.14) * Math.exp(-Math.max(0, t - 0.02) * 17) * 0.17
    const snap = Math.sin(p2 * 1.7 + 0.3) * Math.exp(-Math.max(0, t - 0.01) * 34) * 0.07
    const ring = Math.sin(p1 * 0.82 + Math.sin(p0) * 0.2 + 0.35) * Math.exp(-Math.max(0, t - 0.03) * 7.2) * 0.14
    const haze = Math.sin(p2 * 0.56 + 0.7) * Math.exp(-Math.max(0, t - 0.06) * 5.6) * 0.08
    const laser = core * env + chime + snap + ring + haze
    const sig = Math.tanh((hum * (1 - mix) * 1.35 + laser * mix + dust * 0.16) * 1.5)
    const echo = sig * tail * 0.2
    const left = sig + Math.sin(p1 * 0.996 + 0.2) * tail * 0.03 + echo * 0.72 + ring * 0.28
    const right = sig + Math.sin(p1 * 1.004 + 0.62) * tail * 0.03 + echo + haze * 0.32
    return [left, right] as const
  })
}

function hum() {
  let p0 = 0
  let p1 = 0
  let p2 = 0
  let p3 = 0
  return pcm(SPAN, (t, i) => {
    const rise = Math.max(0, Math.min(1, t / FULL))
    const fade = Math.max(0, Math.min(1, (SPAN - t) / 0.22))
    const attack = Math.min(1, t / 0.05)
    const body = rise * rise * (3 - 2 * rise)
    const env = attack * fade * lerp(0.08, 0.44, body)
    const wobble = 1 + Math.sin(Math.PI * 2 * 3.2 * t) * 0.012
    const f0 = (92 + body * 108 + Math.sin(Math.PI * 2 * (0.85 + body * 1.3) * t) * 1.4) * wobble
    const f1 = f0 * 2.01
    const f2 = f0 * 3.02
    const f3 = 280 + body * 620
    p0 += (Math.PI * 2 * f0) / RATE
    p1 += (Math.PI * 2 * f1) / RATE
    p2 += (Math.PI * 2 * f2) / RATE
    p3 += (Math.PI * 2 * f3) / RATE
    const core = Math.sin(p0) * 0.58 + Math.sin(p1 + Math.sin(p0) * 0.22) * 0.16 + Math.sin(p2 + 0.2) * 0.08
    const air = Math.sin(p3 + Math.sin(p1) * 0.5) * body * 0.06
    const grind = Math.sin((i * 7.173 + 19.17) * 0.013) * 43758.5453
    const dust = (grind - Math.floor(grind) - 0.5) * body * 0.012
    const sig = Math.tanh((core + air + dust) * env * 1.7)
    const left = sig + Math.sin(p1 * 0.998 + 0.1) * body * 0.014
    const right = sig + Math.sin(p1 * 1.002 + 0.5) * body * 0.014
    return [left, right] as const
  })
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t))
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
  let file: Promise<string> | undefined
  let loop: Promise<string> | undefined
  let item: Player | null | undefined
  let kind: Kind | null | undefined
  let proc: Process.Child | undefined
  let seq = 0

  function tone() {
    if (file) return file
    file = (async () => {
      if (!(await Filesystem.exists(FILE))) await Filesystem.write(FILE, wav())
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

  function shot(file: string, volume: number) {
    const item = load()
    if (!item) return run(file, volume)?.exited
    return item.play(file, { volume }).catch(() => run(file, volume)?.exited)
  }

  export function start() {
    stop()
    const id = ++seq
    void rise().then((file) => {
      if (id !== seq) return
      const next = run(file, 0.18)
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

  export function stop(fade = false) {
    seq++
    const next = proc
    proc = undefined
    if (!fade) {
      if (next) void Process.stop(next).catch(() => undefined)
      return
    }
    if (!next) return
    setTimeout(() => {
      void Process.stop(next).catch(() => undefined)
    }, 72)
  }

  export function pulse() {
    stop(true)
    void tone()
      .then((file) => shot(file, 0.36))
      .catch(() => undefined)
  }
}
