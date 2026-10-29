// Turns the screencast frames into a constant-frame-rate H.264 video, and a second copy with the invariant timeline
// drawn in a strip under the app.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

export type Frame = { file: string; at: number }

/** One invariant in the strip: `label` in grey until `at` (epoch ms), then `label time` in its status colour. */
export type Caption = { label: string; time?: string; at?: number; status: "passed" | "failed" | "skipped" }

const FPS = 60

export function ffmpegAvailable() {
  return spawnSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" }).status === 0
}

/** Encodes the frames, each shown until the next one arrived, and returns the video's size. */
export function encode(frames: Frame[], dir: string, output: string, end: number) {
  const list = join(dir, "frames.ffconcat")

  const lines = frames.flatMap((frame, index) => {
    const next = frames[index + 1]?.at ?? end

    return [`file '${basename(frame.file)}'`, `duration ${Math.max(0.001, (next - frame.at) / 1000).toFixed(4)}`]
  })

  // The concat demuxer drops the last entry's duration unless the file is listed once more.
  writeFileSync(list, ["ffconcat version 1.0", ...lines, `file '${basename(frames.at(-1)!.file)}'`, ""].join("\n"))
  const size = jpegSize(frames[0].file)
  const width = size.width - (size.width % 2)
  const height = size.height - (size.height % 2)

  run([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-fps_mode",
    "cfr",
    "-r",
    String(FPS),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "16",
    "-movflags",
    "+faststart",
    output,
  ])

  return { width, height }
}

/** Adds a strip under the video that lights up each invariant at the moment it passed. */
// The clock shows time since launch, like the captions; `start` is the first frame and `launch` the app's spawn (epoch ms).
export function annotate(
  input: string,
  output: string,
  size: { width: number; height: number },
  title: string,
  captions: Caption[],
  start: number,
  launch: number,
) {
  const font = fontFile()

  if (!font) return false
  const scale = size.width / 1280
  const strip = Math.round(64 * scale)
  const fontSize = Math.round(13 * scale)
  const small = Math.round(11 * scale)
  const pad = Math.round(16 * scale)
  const columns = captions.length
  const column = (size.width - pad * 2) / columns
  // Filtergraph escaping has several layers; captions only need words, numbers and a few separators.
  const text = (value: string) => value.replace(/[^\p{L}\p{N} .,·()+\-/]/gu, " ")
  const fontArg = `fontfile='${font.replace(/\\/g, "/").replace(/:/g, "\\:")}'`

  const draw = (value: string, x: number, y: number, color: string, sizeValue: number, enable?: string) =>
    `drawtext=${fontArg}:text='${text(value)}':x=${Math.round(x)}:y=${Math.round(y)}:fontsize=${sizeValue}:fontcolor=${color}${enable ? `:enable='${enable}'` : ""}`

  const filters = [
    `pad=iw:ih+${strip}:0:0:color=0x111111`,
    `drawbox=x=0:y=${size.height}:w=iw:h=1:color=0x2a2a2a:t=fill`,
    draw(title, pad, size.height + pad * 0.6, "0x8a8a8a", small),
    `drawtext=${fontArg}:text='%{pts\\:hms\\:${((start - launch) / 1000).toFixed(3)}}':x=w-tw-${pad}:y=${Math.round(size.height + pad * 0.6)}:fontsize=${small}:fontcolor=0x8a8a8a`,
    ...captions.flatMap((caption, index) => {
      const x = pad + column * index
      const y = size.height + strip - pad - fontSize
      const seconds = caption.at === undefined ? undefined : Math.max(0, (caption.at - start) / 1000)
      const color = caption.status === "failed" ? "0xf85149" : "0x3fb950"
      const lit = seconds === undefined ? undefined : `gte(t,${seconds.toFixed(3)})`

      return [
        draw(caption.label, x, y, "0x555555", fontSize, lit ? `lt(t,${seconds!.toFixed(3)})` : undefined),
        ...(lit ? [draw(`${caption.label} ${caption.time ?? ""}`.trim(), x, y, color, fontSize, lit)] : []),
      ]
    }),
  ]

  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vf",
      filters.join(","),
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "16",
      "-movflags",
      "+faststart",
      output,
    ],
    { encoding: "utf8" },
  )

  if (result.status !== 0) console.warn(`annotated video skipped: ${result.stderr.trim().split("\n").at(-1)}`)

  return result.status === 0
}

/** Joins clips one after another at the size of the last one. */
export function concat(inputs: string[], output: string, size: { width: number; height: number }) {
  const scaled = inputs.map(
    (_, index) =>
      `[${index}:v]scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=0x111111,setsar=1,fps=${FPS},format=yuv420p[v${index}]`,
  )

  run([
    ...inputs.flatMap((input) => ["-i", input]),
    "-filter_complex",
    `${scaled.join(";")};${inputs.map((_, index) => `[v${index}]`).join("")}concat=n=${inputs.length}:v=1:a=0[out]`,
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "16",
    "-movflags",
    "+faststart",
    output,
  ])
}

export function still(input: string, output: string) {
  run(["-sseof", "-0.1", "-i", input, "-frames:v", "1", "-update", "1", output])
}

function run(args: string[]) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" })

  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim()}`)
}

function fontFile() {
  return [
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
  ].find((file) => existsSync(file))
}

// Width and height from the first SOF marker of a JPEG.
function jpegSize(file: string) {
  const data = readFileSync(file)
  let offset = 2

  while (offset < data.length) {
    const marker = data[offset + 1]
    const length = data.readUInt16BE(offset + 2)

    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) }
    offset += 2 + length
  }

  throw new Error(`Not a JPEG: ${file}`)
}
