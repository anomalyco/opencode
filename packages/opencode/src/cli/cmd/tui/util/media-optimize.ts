import { tmpdir } from "os"
import path from "path"
import fs from "fs/promises"
import * as Process from "../../../../util/process"
import { lazy } from "../../../../util/lazy"

const log = (...args: unknown[]) => {
  if (process.env.OPENCODE_DEBUG) console.error("[media-optimize]", ...args)
}

// ---------------------------------------------------------------------------
// Tool detection (lazy, cached)
// ---------------------------------------------------------------------------

const getWhich = lazy(async () => {
  const { which } = await import("../../../../util/which")
  return which
})

async function hasTool(name: string): Promise<boolean> {
  const which = await getWhich()
  return which(name) !== null
}

const hasSips = lazy(() => hasTool("sips"))
const hasImageMagick = lazy(async () => (await hasTool("magick")) || (await hasTool("convert")))
const hasFfmpeg = lazy(() => hasTool("ffmpeg"))
const hasFfprobe = lazy(() => hasTool("ffprobe"))
const hasShiftAi = lazy(() => hasTool("shift-ai"))

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MediaInput {
  content: string // base64
  mime: string
  filename?: string
}

export interface MediaOutput {
  /** Optimized parts. Usually 1; video decomposition may produce N. */
  parts: MediaInput[]
  changed: boolean
}

/** Per-part metrics from optimization. */
export interface OptimizeMetrics {
  mime: string
  filename?: string
  originalBytes: number
  optimizedBytes: number
  tool: string
  durationMs: number
}

/** Config knobs for media optimization. */
export interface OptimizeConfig {
  /** Disable all optimization. Default: false. */
  disabled?: boolean
  /** Max dimension (px) for longest image side. Default: 1568. */
  maxDimension?: number
  /** JPEG quality (1-100). Default: 80. */
  quality?: number
  /** Min base64 length to trigger image optimization. Default: 100_000 (~75KB raw). */
  minImageSize?: number
  /** Max keyframes to extract from video. Default: 5. */
  maxKeyframes?: number
  /** Audio sample rate (Hz). Default: 16000. */
  audioSampleRate?: number
}

const DEFAULTS: Required<OptimizeConfig> = {
  disabled: false,
  maxDimension: 1568,
  quality: 80,
  minImageSize: 100_000,
  maxKeyframes: 5,
  audioSampleRate: 16000,
}

function cfg(override?: OptimizeConfig): Required<OptimizeConfig> {
  if (!override) return DEFAULTS
  return { ...DEFAULTS, ...override }
}

// ---------------------------------------------------------------------------
// Metrics collection
// ---------------------------------------------------------------------------

const recentMetrics: OptimizeMetrics[] = []

function recordMetric(m: OptimizeMetrics) {
  recentMetrics.push(m)
  // Keep at most 100 recent entries
  if (recentMetrics.length > 100) recentMetrics.shift()
  log(
    `${m.tool}: ${m.mime} ${m.originalBytes} → ${m.optimizedBytes} bytes ` +
      `(${Math.round((1 - m.optimizedBytes / m.originalBytes) * 100)}% saved, ${m.durationMs}ms)`,
  )
}

/** Return a copy of recent optimization metrics for external inspection. */
export function getMetrics(): readonly OptimizeMetrics[] {
  return [...recentMetrics]
}

// ---------------------------------------------------------------------------
// External optimizer override
// ---------------------------------------------------------------------------

type Optimizer = (input: MediaInput, config: Required<OptimizeConfig>) => Promise<MediaOutput>

const optimizerOverrides = new Map<string, Optimizer>()

/**
 * Register an external optimizer for a modality (e.g. "image", "audio").
 * When registered, the external optimizer runs INSTEAD of the built-in one.
 * Returns a dispose function to unregister.
 *
 * This is the extension point for plugins like SHIFT:
 * ```ts
 * registerOptimizer("image", async (input, config) => {
 *   // call shift-ai, return optimized parts
 * })
 * ```
 */
export function registerOptimizer(modality: string, fn: Optimizer): () => void {
  optimizerOverrides.set(modality, fn)
  return () => { optimizerOverrides.delete(modality) }
}

// ---------------------------------------------------------------------------
// Temp file helpers
// ---------------------------------------------------------------------------

const tmpCounter = { value: 0 }

function tmpPath(ext: string): string {
  return path.join(tmpdir(), `opencode-media-${process.pid}-${Date.now()}-${++tmpCounter.value}${ext}`)
}

async function writeBase64(filepath: string, b64: string): Promise<void> {
  await fs.writeFile(filepath, Buffer.from(b64, "base64"))
}

async function readBase64(filepath: string): Promise<string> {
  const buf = await fs.readFile(filepath)
  return buf.toString("base64")
}

async function cleanup(...paths: string[]) {
  for (const p of paths) {
    await fs.rm(p, { force: true }).catch(() => {})
  }
}

function b64bytes(b64: string): number {
  return Math.ceil((b64.length * 3) / 4)
}

// ---------------------------------------------------------------------------
// Image optimization
// ---------------------------------------------------------------------------

function extForMime(mime: string): string {
  if (mime === "image/png") return ".png"
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg"
  if (mime === "image/gif") return ".gif"
  if (mime === "image/webp") return ".webp"
  if (mime === "image/heic" || mime === "image/heif") return ".heic"
  if (mime === "image/bmp") return ".bmp"
  if (mime === "image/tiff") return ".tiff"
  if (mime === "application/pdf") return ".pdf"
  if (mime.startsWith("audio/")) return ".wav"
  if (mime.startsWith("video/")) return ".mp4"
  return ""
}

async function optimizeImageSips(input: MediaInput, config: Required<OptimizeConfig>): Promise<MediaOutput> {
  const ext = extForMime(input.mime)
  const src = tmpPath(ext)
  const dst = tmpPath(".jpg")
  try {
    await writeBase64(src, input.content)

    await Process.run(
      [
        "sips",
        "--resampleHeightWidthMax",
        String(config.maxDimension),
        "--setProperty",
        "format",
        "jpeg",
        "--setProperty",
        "formatOptions",
        String(config.quality),
        src,
        "--out",
        dst,
      ],
      { nothrow: true },
    )

    const stat = await fs.stat(dst).catch(() => null)
    if (!stat || stat.size === 0) return { parts: [input], changed: false }

    const originalSize = b64bytes(input.content)
    if (stat.size >= originalSize) return { parts: [input], changed: false }

    const optimized = await readBase64(dst)
    return {
      parts: [{ content: optimized, mime: "image/jpeg", filename: input.filename }],
      changed: true,
    }
  } finally {
    await cleanup(src, dst)
  }
}

async function optimizeImageMagick(input: MediaInput, config: Required<OptimizeConfig>): Promise<MediaOutput> {
  const ext = extForMime(input.mime)
  const src = tmpPath(ext)
  const dst = tmpPath(".jpg")
  try {
    await writeBase64(src, input.content)

    const cmd = (await hasTool("magick")) ? "magick" : "convert"
    await Process.run(
      [cmd, src, "-resize", `${config.maxDimension}x${config.maxDimension}>`, "-quality", String(config.quality), dst],
      { nothrow: true },
    )

    const stat = await fs.stat(dst).catch(() => null)
    if (!stat || stat.size === 0) return { parts: [input], changed: false }

    const originalSize = b64bytes(input.content)
    if (stat.size >= originalSize) return { parts: [input], changed: false }

    const optimized = await readBase64(dst)
    return {
      parts: [{ content: optimized, mime: "image/jpeg", filename: input.filename }],
      changed: true,
    }
  } finally {
    await cleanup(src, dst)
  }
}

async function optimizeImage(input: MediaInput, config: Required<OptimizeConfig>): Promise<MediaOutput> {
  if (input.mime === "image/svg+xml") return { parts: [input], changed: false }
  if (input.content.length < config.minImageSize) return { parts: [input], changed: false }

  if (await hasSips()) return optimizeImageSips(input, config)
  if (await hasImageMagick()) return optimizeImageMagick(input, config)

  return { parts: [input], changed: false }
}

// ---------------------------------------------------------------------------
// Audio optimization
// ---------------------------------------------------------------------------

async function optimizeAudio(input: MediaInput, config: Required<OptimizeConfig>): Promise<MediaOutput> {
  if (!(await hasFfmpeg())) return { parts: [input], changed: false }

  const ext = extForMime(input.mime)
  const src = tmpPath(ext || ".bin")
  const dst = tmpPath(".wav")
  try {
    await writeBase64(src, input.content)
    await Process.run(
      ["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", String(config.audioSampleRate), "-sample_fmt", "s16", dst],
      { nothrow: true },
    )

    const stat = await fs.stat(dst).catch(() => null)
    if (!stat || stat.size === 0) return { parts: [input], changed: false }

    const optimized = await readBase64(dst)
    return {
      parts: [{ content: optimized, mime: "audio/wav", filename: input.filename }],
      changed: true,
    }
  } finally {
    await cleanup(src, dst)
  }
}

// ---------------------------------------------------------------------------
// Video optimization — extract keyframes + optional audio
// ---------------------------------------------------------------------------

async function optimizeVideo(input: MediaInput, config: Required<OptimizeConfig>): Promise<MediaOutput> {
  if (!(await hasFfmpeg())) return { parts: [input], changed: false }

  const ext = extForMime(input.mime)
  const src = tmpPath(ext || ".bin")
  const framePattern = tmpPath("") + "-frame-%03d.jpg"
  const audioPath = tmpPath(".wav")
  const frameIndices = Array.from({ length: config.maxKeyframes }, (_, i) => i + 1)
  try {
    await writeBase64(src, input.content)

    const audioDetected = await (async () => {
      if (!(await hasFfprobe())) return false
      const probe = await Process.text(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", src],
        { nothrow: true },
      )
      return probe.text.trim().includes("audio")
    })()

    await Process.run(
      [
        "ffmpeg",
        "-y",
        "-i",
        src,
        "-vf",
        `select=eq(pict_type\\,I),scale=${config.maxDimension}:${config.maxDimension}:force_original_aspect_ratio=decrease`,
        "-vsync",
        "vfr",
        "-frames:v",
        String(config.maxKeyframes),
        "-q:v",
        "4",
        framePattern,
      ],
      { nothrow: true },
    )

    const baseName = input.filename ?? "video"
    const parts: MediaInput[] = []
    for (const i of frameIndices) {
      const framePath = framePattern.replace("%03d", String(i).padStart(3, "0"))
      const stat = await fs.stat(framePath).catch(() => null)
      if (!stat || stat.size === 0) break
      parts.push({
        content: await readBase64(framePath),
        mime: "image/jpeg",
        filename: `${baseName}-frame-${i}.jpg`,
      })
      await cleanup(framePath)
    }

    if (parts.length === 0) return { parts: [input], changed: false }

    if (audioDetected) {
      await Process.run(
        ["ffmpeg", "-y", "-i", src, "-vn", "-ac", "1", "-ar", String(config.audioSampleRate), "-sample_fmt", "s16", audioPath],
        { nothrow: true },
      )
      const stat = await fs.stat(audioPath).catch(() => null)
      if (stat && stat.size > 0) {
        parts.push({
          content: await readBase64(audioPath),
          mime: "audio/wav",
          filename: `${baseName}-audio.wav`,
        })
      }
    }

    return { parts, changed: true }
  } finally {
    await cleanup(src, audioPath)
    for (const i of frameIndices) {
      await cleanup(framePattern.replace("%03d", String(i).padStart(3, "0")))
    }
  }
}

// ---------------------------------------------------------------------------
// PDF optimization (placeholder)
// ---------------------------------------------------------------------------

async function optimizePdf(input: MediaInput, _config: Required<OptimizeConfig>): Promise<MediaOutput> {
  return { parts: [input], changed: false }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function mimeToModality(mime: string): "image" | "audio" | "video" | "pdf" | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

const builtinHandlers: Record<string, Optimizer> = {
  image: optimizeImage,
  audio: optimizeAudio,
  video: optimizeVideo,
  pdf: optimizePdf,
}

/**
 * Optimize a media attachment before it is sent as a prompt part.
 *
 * Dispatches to modality-specific optimizers. External plugins can override
 * any modality via `registerOptimizer()`. Falls back to built-in optimizers
 * that use locally available tools (sips, ImageMagick, ffmpeg).
 *
 * Degrades gracefully: returns the input unchanged when tools are missing
 * or when optimization fails.
 */
export async function optimizeMedia(input: MediaInput, override?: OptimizeConfig): Promise<MediaOutput> {
  const config = cfg(override)
  if (config.disabled) return { parts: [input], changed: false }

  const passthrough: MediaOutput = { parts: [input], changed: false }
  const modality = mimeToModality(input.mime)
  if (!modality) return passthrough

  // External overrides take priority (e.g. SHIFT plugin)
  const handler = optimizerOverrides.get(modality) ?? builtinHandlers[modality]
  if (!handler) return passthrough

  const tool = optimizerOverrides.has(modality) ? `plugin:${modality}` : `builtin:${modality}`
  const start = Date.now()
  const originalBytes = b64bytes(input.content)

  return handler(input, config)
    .then((result) => {
      const optimizedBytes = result.parts.reduce((sum, p) => sum + b64bytes(p.content), 0)
      if (result.changed) {
        recordMetric({
          mime: input.mime,
          filename: input.filename,
          originalBytes,
          optimizedBytes,
          tool,
          durationMs: Date.now() - start,
        })
      }
      return result
    })
    .catch((err) => {
      log("optimization failed, passing through unmodified", err)
      return passthrough
    })
}

/**
 * Optimize all file parts in an assembled parts array (right before submit).
 * This is the integration point for the `message.parts.before` pattern
 * from issue #24125.
 *
 * Non-file parts and non-media files pass through unchanged.
 */
export async function optimizeParts(
  parts: Array<{ type: string; mime?: string; url?: string; filename?: string; [key: string]: unknown }>,
  override?: OptimizeConfig,
): Promise<{ parts: typeof parts; metrics: OptimizeMetrics[] }> {
  const config = cfg(override)
  if (config.disabled) return { parts, metrics: [] }

  const before = recentMetrics.length
  const result: typeof parts = []

  for (const part of parts) {
    if (part.type !== "file" || !part.mime || !part.url) {
      result.push(part)
      continue
    }

    const match = (part.url as string).match(/^data:([^;]+);base64,(.+)$/s)
    if (!match) {
      result.push(part)
      continue
    }

    const [, , b64data] = match
    const modality = mimeToModality(part.mime)
    if (!modality) {
      result.push(part)
      continue
    }

    const optimized = await optimizeMedia(
      { content: b64data, mime: part.mime, filename: part.filename },
      override,
    )

    if (!optimized.changed) {
      result.push(part)
      continue
    }

    for (const opt of optimized.parts) {
      result.push({
        ...part,
        mime: opt.mime,
        filename: opt.filename,
        url: `data:${opt.mime};base64,${opt.content}`,
      })
    }
  }

  const metrics = recentMetrics.slice(before)
  return { parts: result, metrics }
}

/** Returns true if the given mime type is a media type that can be attached. */
export function isAttachable(mime: string): boolean {
  return (
    mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime === "application/pdf"
  )
}
