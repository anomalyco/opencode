import { artifactKind, artifactMime, type ArtifactKind } from "@opencode/util/artifact"
import type { FileContent } from "@opencode/gui-extensions/sdk"

/** Kinds whose raw bytes are kept so media elements and binary viewers can read them without a text round trip. */
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

/** Kinds a media element reads straight from the server, so it shows the first frame before the rest arrives. */
export const streamedKinds = new Set<ArtifactKind>(["image", "audio", "video"])

/** Content for a streamed file from a HEAD of its URL. A changed file gets a new URL, so its element reloads. */
export function streamedFileContent(path: string, url: string, response: Response): FileContent {
  const size = Number(response.headers.get("content-length") ?? 0)
  const versioned = new URL(url)
  versioned.searchParams.set("v", `${size}-${Date.parse(response.headers.get("last-modified") ?? "") || 0}`)

  return { type: "binary", content: "", size, mimeType: artifactMime(path), url: versioned.href }
}

/** Text files never contain NUL; a NUL in the first 8 KiB marks an unknown binary. */
function isBinaryBytes(bytes: Uint8Array) {
  return bytes.subarray(0, 8192).includes(0)
}

/** Media above this stays a placeholder so the in-memory file cache stays bounded. */
export const MAX_MEDIA_BYTES = 256 * 1024 * 1024

export function fileContentFromBytes(path: string, bytes: Uint8Array): FileContent {
  const kind = artifactKind(path)
  const mimeType = artifactMime(path)

  if (binaryKinds.has(kind)) {
    if (bytes.length > MAX_MEDIA_BYTES) return { type: "binary", content: "", size: bytes.length }

    return { type: "binary", content: "", bytes, mimeType }
  }

  // Unknown binaries keep no bytes: the viewer only shows a placeholder for them.
  if (kind === "text" && isBinaryBytes(bytes)) return { type: "binary", content: "", size: bytes.length }

  return { type: "text", content: new TextDecoder().decode(bytes), mimeType }
}
