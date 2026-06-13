import { getFilename } from "@cedric/core/util/path"
import type { FileSystemBinaryContent, FileSystemTextContent } from "@cedric/sdk/v2"

export function serverAttachmentFile(path: string, data: FileSystemTextContent | FileSystemBinaryContent) {
  const content =
    data.type === "text" ? data.content : Uint8Array.from(atob(data.content), (char) => char.charCodeAt(0))
  return new File([content], getFilename(path), { type: data.mime })
}
