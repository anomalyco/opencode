import { artifactKind, artifactMime, type ArtifactKind } from "@opencode/util/artifact"
import { bytesToBase64 } from "@opencode/util/base64"
import type { FileContent } from "@/runtime/server/types"

/** Kinds whose bytes are kept as base64 so media elements can play them without a text round trip. */
const binaryKinds = new Set<ArtifactKind>([
  "image",
  "audio",
  "video",
  "pdf",
  "font",
  "document",
  "spreadsheet",
  "presentation",
])

/** Text files never contain NUL; a NUL in the first 8 KiB marks an unknown binary. */
function isBinaryBytes(bytes: Uint8Array) {
  return bytes.subarray(0, 8192).includes(0)
}

/** Media above this stays a placeholder: base64 encoding on the main thread and the LRU budget both suffer. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024

export function fileContentFromBytes(path: string, bytes: Uint8Array): FileContent {
  const kind = artifactKind(path)
  const mimeType = artifactMime(path)

  if (binaryKinds.has(kind)) {
    if (bytes.length > MAX_MEDIA_BYTES) return { type: "binary", content: "", size: bytes.length }

    return { type: "binary", content: bytesToBase64(bytes), encoding: "base64", mimeType }
  }

  // Unknown binaries keep no bytes: the viewer only shows a placeholder for them.
  if (kind === "text" && isBinaryBytes(bytes)) return { type: "binary", content: "", size: bytes.length }

  return { type: "text", content: new TextDecoder().decode(bytes), mimeType }
}
