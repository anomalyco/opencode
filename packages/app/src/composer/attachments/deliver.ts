import type { Accessor } from "solid-js"
import { blobBytes, blobDataUrl } from "@/runtime/persistence/drafts"
import { useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ComposerControls } from "../adapter"
import type { ImageAttachmentPart } from "../state"

// Where a prompt is headed: the model that reads it and the server that runs its tools.
export type AttachmentDestination = {
  /** Input modalities the selected model reads natively. */
  input: { image: boolean; pdf: boolean }
  /** The server shares the client's filesystem, so an attachment's source path resolves as-is. */
  local: boolean
  /** Copies a file into the server's temporary directory and returns its absolute path there. */
  upload: (file: { name: string; data: Uint8Array }) => Promise<string>
}

export type DeliveredAttachment =
  | { type: "inline"; attachment: ImageAttachmentPart; dataUrl: string }
  | { type: "path"; attachment: ImageAttachmentPart; path: string }

// An attachment travels inline when the model reads its bytes natively. Anything else reaches
// the model as a path on the server, which its tools can open, instead of being rejected.
export function deliverAttachments(attachments: ImageAttachmentPart[], destination: AttachmentDestination) {
  return Promise.all(attachments.map((attachment) => deliver(attachment, destination)))
}

async function deliver(
  attachment: ImageAttachmentPart,
  destination: AttachmentDestination,
): Promise<DeliveredAttachment> {
  if (native(attachment.mime, destination.input)) {
    return { type: "inline", attachment, dataUrl: await blobDataUrl(attachment.blob, attachment.mime) }
  }
  if (destination.local && attachment.sourcePath) return { type: "path", attachment, path: attachment.sourcePath }
  const path = await destination.upload({ name: attachment.filename, data: await blobBytes(attachment.blob) })
  return { type: "path", attachment, path }
}

const imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

// Mirrors the attachment kinds the server forwards to the model as message content.
function native(mime: string, input: AttachmentDestination["input"]) {
  if (mime === "text/plain") return true
  if (imageMimes.has(mime)) return input.image
  if (mime === "application/pdf") return input.pdf
  return false
}

export function useAttachmentDestination(controls: Accessor<ComposerControls>) {
  const server = useServer()
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  return (): AttachmentDestination => ({
    input: controls().model.selection.current()?.capabilities.input ?? { image: false, pdf: false },
    local: server.isLocal,
    upload: async (file) => {
      const info = await sdk.api.server.info()
      // One directory per upload keeps the original filename without collisions; the server
      // normalizes the separators and returns the resolved path.
      const written = await sdk.api.file.write({
        location: { directory: location().directory },
        path: `${info.paths.tmp}/uploads/${crypto.randomUUID()}/${file.name}`,
        payload: file.data,
      })
      return written.data.path
    },
  })
}
