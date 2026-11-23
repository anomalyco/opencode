export * as PhotonNormalize from "./photon-normalize.js"

import photonWasm from "#photon-wasm"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { FileSystem } from "../filesystem.js"
import type { Limits } from "../image.js"

// Plain data on purpose: this module runs on the server thread and inside the
// photon worker, and its results cross postMessage.

export type Photon = typeof import("@silvia-odwyer/photon-node")
export type Content = FileSystem.Content & { readonly encoding: "base64" }
export type Size = {
  readonly width: number
  readonly height: number
  readonly bytes: number
  readonly maxWidth: number
  readonly maxHeight: number
  readonly maxBytes: number
}
// Unchanged lets the worker skip copying the caller's base64 back.
export type Result =
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Content"; readonly content: Content }
  | { readonly _tag: "DecodeError" }
  | ({ readonly _tag: "SizeError" } & Size)

const PNG_PASSTHROUGH_MAX_BASE64_BYTES = 384 * 1024
const SMALL_PNG_MAX_PIXELS = 256 * 256
const JPEG_QUALITIES = [80, 70, 55, 40]

// A runtime without a photon wasm artifact (#photon-wasm resolves to the empty
// string on workerd) has no resizer, by declaration.
export const available = photonWasm !== ""

export async function load(): Promise<Photon> {
  if (!available) throw new Error("photon wasm is unavailable")
  ;(globalThis as typeof globalThis & { __OPENCODE_PHOTON_WASM_PATH?: string }).__OPENCODE_PHOTON_WASM_PATH =
    path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
  return await import("@silvia-odwyer/photon-node")
}

// Base64 uses four bytes per three input bytes, including padding.
const base64Length = (bytes: Uint8Array) => Math.ceil(bytes.length / 3) * 4

// Samples an evenly spaced grid of up to 64×64 pixels.
function hasTransparency(pixels: Uint8Array, width: number, height: number) {
  const columns = Math.min(64, width)
  const rows = Math.min(64, height)
  let transparent = 0
  for (let row = 0; row < rows; row++) {
    const y = Math.floor(((row + 0.5) * height) / rows)
    for (let column = 0; column < columns; column++) {
      const x = Math.floor(((column + 0.5) * width) / columns)
      if (pixels[(y * width + x) * 4 + 3]! < 250) transparent++
    }
  }
  return transparent / (columns * rows) > 0.05
}

export function normalize(photon: Photon, content: Content, limits: Readonly<Limits>): Result {
  let decoded: InstanceType<Photon["PhotonImage"]>
  try {
    decoded = photon.PhotonImage.new_from_byteslice(Buffer.from(content.content, "base64"))
  } catch {
    return { _tag: "DecodeError" }
  }
  try {
    const width = decoded.get_width()
    const height = decoded.get_height()
    const bytes = Buffer.byteLength(content.content, "utf-8")
    const sizeError: Result = {
      _tag: "SizeError",
      width,
      height,
      bytes,
      maxWidth: limits.maxWidth,
      maxHeight: limits.maxHeight,
      maxBytes: limits.maxBase64Bytes,
    }
    const fits = width <= limits.maxWidth && height <= limits.maxHeight && bytes <= limits.maxBase64Bytes
    const smallPng = bytes <= PNG_PASSTHROUGH_MAX_BASE64_BYTES || width * height <= SMALL_PNG_MAX_PIXELS
    if (fits && (!limits.autoResize || content.mime !== "image/png" || smallPng)) return { _tag: "Unchanged" }
    if (!limits.autoResize) return sizeError
    const transparent = content.mime !== "image/jpeg" && hasTransparency(decoded.get_raw_pixels(), width, height)
    // An image that already fits only changes when JPEG makes it smaller.
    if (fits) {
      if (transparent) return { _tag: "Unchanged" }
      const jpeg = decoded.get_bytes_jpeg(JPEG_QUALITIES[0]!)
      return base64Length(jpeg) < bytes
        ? {
            _tag: "Content",
            content: {
              ...content,
              content: Buffer.from(jpeg).toString("base64"),
              encoding: "base64",
              mime: "image/jpeg",
            },
          }
        : { _tag: "Unchanged" }
    }
    const scale = Math.min(1, limits.maxWidth / width, limits.maxHeight / height)
    const sizes = Array.from({ length: 32 }).reduce<Array<{ width: number; height: number }>>((acc) => {
      const previous = acc.at(-1) ?? {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      }
      const next =
        acc.length === 0
          ? previous
          : {
              width: previous.width === 1 ? 1 : Math.max(1, Math.floor(previous.width * 0.75)),
              height: previous.height === 1 ? 1 : Math.max(1, Math.floor(previous.height * 0.75)),
            }
      return acc.some((item) => item.width === next.width && item.height === next.height) ? acc : [...acc, next]
    }, [])
    for (const size of sizes) {
      const resized =
        size.width === width && size.height === height
          ? decoded
          : photon.resize(decoded, size.width, size.height, photon.SamplingFilter.Lanczos3)
      try {
        const pngEncoder = ["image/png", () => resized.get_bytes()] as const
        const jpegEncoders = JPEG_QUALITIES.map(
          (quality) => ["image/jpeg", () => resized.get_bytes_jpeg(quality)] as const,
        )
        const pngFirst = transparent || size.width * size.height <= SMALL_PNG_MAX_PIXELS
        const encoders: Array<readonly [mime: string, encode: () => Uint8Array]> = pngFirst
          ? [pngEncoder, ...jpegEncoders]
          : [...jpegEncoders, pngEncoder]
        for (const [mime, encode] of encoders) {
          const candidate = encode()
          if (base64Length(candidate) <= limits.maxBase64Bytes)
            return {
              _tag: "Content",
              content: { ...content, content: Buffer.from(candidate).toString("base64"), encoding: "base64", mime },
            }
        }
      } finally {
        if (resized !== decoded) resized.free()
      }
    }
    return sizeError
  } finally {
    decoded.free()
  }
}
