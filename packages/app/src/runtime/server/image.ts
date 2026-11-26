import { artifactKind, artifactMime } from "@opencode/util/artifact"
import { getDirectory, getFilename } from "@opencode/util/path"
import type { OpenCodeClient } from "@opencode/client/promise"
import type { MarkdownMediaSource } from "@opencode/session-ui/context/markdown"
import { fileStreamUrl, type MediaServer } from "./file-stream"

const types = new Map([
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
])

export async function readLocalImage(
  api: Pick<OpenCodeClient, "file">,
  directory: string,
  path: string,
  signal: AbortSignal,
): Promise<Blob | undefined> {
  const request = localFileRequest(directory, path)
  const type = types.get(path.match(/\.([^./]+)$/)?.[1]?.toLowerCase() ?? "")

  if (!request || !type) return
  const bytes = await api.file.read(request, { signal })

  return new Blob([new Uint8Array(bytes)], { type })
}

/**
 * A local video or audio file for an inline media element. A server without a password streams it with range
 * requests, so playback starts before the file arrives; a password-protected server downloads it as a Blob instead,
 * because a media element cannot send the Authorization header.
 */
export async function readLocalMedia(
  api: Pick<OpenCodeClient, "file">,
  server: MediaServer,
  directory: string,
  path: string,
  signal: AbortSignal,
): Promise<MarkdownMediaSource | undefined> {
  const request = localFileRequest(directory, path)
  const mime = artifactMime(path)
  const kind = artifactKind(path)

  if (!request || !mime || (kind !== "audio" && kind !== "video")) return
  const url = fileStreamUrl(server, { path: request.path, directory: request.location.directory })

  if (url) return { url, revoke: false }
  const bytes = await api.file.read(request, { signal })

  return { url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime })), revoke: true }
}

function localFileRequest(directory: string, path: string) {
  const drive = /^[a-z]:[\\/]/i.test(path)

  if (/^[\\/]{2}/.test(path) || (!drive && /^[a-z][a-z\d+.-]*:/i.test(path))) return
  const absolute = drive || path.startsWith("/")

  // Scope absolute files to their parent, including files outside the project.
  return {
    path: absolute ? getFilename(path) : path,
    location: { directory: absolute ? getDirectory(path) : directory },
  }
}
