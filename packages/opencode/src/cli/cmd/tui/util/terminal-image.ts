import { writeFileSync } from "node:fs"
import path from "node:path"

export const TerminalImageOSC = /\x1b\]1337;File=/

const imageMime = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
} satisfies Record<string, string>

let terminalImageWriteQueue = Promise.resolve()

export type TerminalImageDisplayOptions = {
  width?: number
  height?: number
  preserveAspectRatio?: boolean
  doNotMoveCursor?: boolean
}

export type TerminalImagePlacementOptions = {
  x: number
  y: number
  width: number
  height: number
}

export type TerminalImageSize = {
  width: number
  height: number
}

export type TerminalImageSector = {
  columns: number
  rows: number
}

export function hasTerminalImageOutput(output: string) {
  return TerminalImageOSC.test(output)
}

export function supportsTerminalImageOutput(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") return false
  if (env.TMUX) return false
  if (env.ITERM_SESSION_ID) return true
  if (env.LC_TERMINAL?.toLowerCase() === "iterm2") return true
  if (env.TERM_PROGRAM?.toLowerCase() === "iterm.app") return supportsITermImageVersion(env.TERM_PROGRAM_VERSION)
  return false
}

export async function writeTerminalImageOutput(
  raw: string,
  options: {
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    write?: (raw: string) => Promise<void>
    placement?: TerminalImagePlacementOptions
  } = {},
) {
  if (!hasTerminalImageOutput(raw)) return false
  if (!supportsTerminalImageOutput(options.env, options.platform)) return false
  await writeQueued(options.placement ? terminalImagePlacementOutput(raw, options.placement) : raw, options.write)
  return true
}

export async function writeTerminalImageFileOutput(
  filePath: string,
  options: {
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    write?: (raw: string) => Promise<void>
    display?: TerminalImageDisplayOptions
    placement?: TerminalImagePlacementOptions
  } = {},
) {
  if (!supportsTerminalImageOutput(options.env, options.platform)) return false
  const raw = await terminalImageOutputFromFile(filePath, options.display)
  if (!raw) return false
  await writeQueued(options.placement ? terminalImagePlacementOutput(raw, options.placement) : raw, options.write)
  return true
}

export async function terminalImageOutputFromFile(filePath: string, options: TerminalImageDisplayOptions = {}) {
  const mime = imageMime[path.extname(filePath).toLowerCase().slice(1) as keyof typeof imageMime]
  if (!mime) return
  const file = Bun.file(filePath)
  if (!(await file.exists())) return
  return `\x1b]1337;File=${terminalImageParams(path.basename(filePath), options)}:${Buffer.from(await file.arrayBuffer()).toString("base64")}\x07`
}

export async function terminalImageSizeFromFile(filePath: string) {
  const mime = imageMime[path.extname(filePath).toLowerCase().slice(1) as keyof typeof imageMime]
  if (!mime) return
  const file = Bun.file(filePath)
  if (!(await file.exists())) return
  return terminalImageSize(Buffer.from(await file.arrayBuffer()), path.extname(filePath).toLowerCase().slice(1))
}

export function terminalImageSector(
  size: TerminalImageSize,
  options: { maxWidth: number; maxHeight?: number; cellWidth?: number; cellHeight?: number },
) {
  const cellWidth = options.cellWidth ?? 9
  const cellHeight = options.cellHeight ?? 18
  const imageWidth = Math.max(1, size.width)
  const imageHeight = Math.max(1, size.height)
  const maxWidth = Math.max(1, Math.floor(options.maxWidth))
  const maxHeight = Math.max(1, Math.floor(options.maxHeight ?? Number.POSITIVE_INFINITY))
  const columns = Math.min(maxWidth, Math.max(1, Math.ceil(imageWidth / cellWidth)))
  const rows = Math.max(1, Math.ceil((imageHeight * ((columns * cellWidth) / imageWidth)) / cellHeight))
  if (rows <= maxHeight) return { columns, rows }
  const heightBoundColumns = Math.max(1, Math.ceil((imageWidth * ((maxHeight * cellHeight) / imageHeight)) / cellWidth))
  return {
    columns: Math.min(maxWidth, heightBoundColumns),
    rows: maxHeight,
  }
}

export function terminalImageSectorFromOutput(raw: string, options: { maxWidth: number; maxHeight?: number }) {
  const params = raw.match(/\x1b\]1337;File=([^:]*):/)?.[1]
  if (!params) return
  const width = terminalImageCellParam(params, "width")
  const height = terminalImageCellParam(params, "height")
  if (!height) return
  const maxHeight = Math.max(1, Math.floor(options.maxHeight ?? Number.POSITIVE_INFINITY))
  return {
    columns: Math.min(Math.max(1, Math.floor(options.maxWidth)), width ?? Math.max(1, Math.floor(options.maxWidth))),
    rows: Math.min(height, maxHeight),
  }
}

export function terminalImagePlacementOutput(raw: string, options: TerminalImagePlacementOptions) {
  const x = Math.max(1, Math.floor(options.x) + 1)
  const y = Math.max(1, Math.floor(options.y) + 1)
  const width = Math.max(1, Math.floor(options.width))
  const height = Math.max(1, Math.floor(options.height))
  const clear = Array.from({ length: height }, (_, row) => `\x1b[${y + row};${x}H\x1b[${width}X`).join("")
  return `\x1b7${clear}\x1b[${y};${x}H${raw}\x1b8`
}

export function terminalImagePath(input: Record<string, unknown> | undefined) {
  const value = input?.path ?? input?.filePath ?? input?.file_path
  if (typeof value !== "string") return
  return value
}

function supportsITermImageVersion(version: string | undefined) {
  if (!version) return true
  const parsed = version
    .split(/\D+/)
    .filter(Boolean)
    .map((part) => Number(part))
  if (parsed.some((part) => Number.isNaN(part))) return true
  const [major = 0, minor = 0, patch = 0] = parsed
  if (major > 2) return true
  if (major < 2) return false
  if (minor > 9) return true
  if (minor < 9) return false
  return patch >= 20150512
}

function terminalImageParams(name: string, options: TerminalImageDisplayOptions) {
  return [
    `name=${Buffer.from(name).toString("base64")}`,
    "inline=1",
    `doNotMoveCursor=${options.doNotMoveCursor === false ? 0 : 1}`,
    options.preserveAspectRatio === undefined ? undefined : `preserveAspectRatio=${options.preserveAspectRatio ? 1 : 0}`,
    terminalImageDimension("width", options.width),
    terminalImageDimension("height", options.height),
  ]
    .filter((param): param is string => Boolean(param))
    .join(";")
}

function terminalImageDimension(name: "width" | "height", value: number | undefined) {
  if (!value) return
  return `${name}=${Math.max(1, Math.floor(value))}`
}

function terminalImageCellParam(params: string, name: "width" | "height") {
  const value = params
    .split(";")
    .find((param) => param.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  if (!value?.match(/^\d+$/)) return
  return Math.max(1, Number(value))
}

function terminalImageSize(buffer: Buffer, extension: string): TerminalImageSize | undefined {
  if (extension === "png") return pngSize(buffer)
  if (extension === "gif") return gifSize(buffer)
  if (extension === "jpg" || extension === "jpeg") return jpegSize(buffer)
  if (extension === "webp") return webpSize(buffer)
}

function pngSize(buffer: Buffer): TerminalImageSize | undefined {
  if (buffer.length < 24) return
  if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function gifSize(buffer: Buffer): TerminalImageSize | undefined {
  if (buffer.length < 10) return
  if (!buffer.toString("ascii", 0, 6).match(/^GIF8[79]a$/)) return
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

function jpegSize(buffer: Buffer): TerminalImageSize | undefined {
  if (buffer.length < 4) return
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (sof.has(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    offset += 2 + length
  }
}

function webpSize(buffer: Buffer): TerminalImageSize | undefined {
  if (buffer.length < 30) return
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return
  if (buffer.toString("ascii", 12, 16) !== "VP8X") return
  return {
    width: buffer.readUIntLE(24, 3) + 1,
    height: buffer.readUIntLE(27, 3) + 1,
  }
}

async function writeToControllingTerminal(raw: string) {
  try {
    writeFileSync("/dev/tty", raw)
  } catch {
    // Best-effort rendering: terminal image output is optional and should never break the TUI.
  }
}

async function writeQueued(raw: string, write = writeToControllingTerminal) {
  terminalImageWriteQueue = terminalImageWriteQueue.then(() => write(raw), () => write(raw))
  await terminalImageWriteQueue
}
