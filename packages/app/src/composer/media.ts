import { blobDataUrl, pinMediaBlob } from "@/runtime/persistence/drafts"
import { mediaHashFromUri } from "@/runtime/server/media"
import type { Prompt } from "./state"

/** {@link pinMediaBlob} for every `media:<hash>` image and file in a prompt, before its server copy can be swept. */
export async function pinPromptMedia(prompt: Prompt): Promise<Prompt> {
  return Promise.all(
    prompt.map(async (part) => {
      if (part.type === "image") return { ...part, blob: await pinMediaBlob(part.blob) }
      const url = part.type === "file" ? part.url : undefined

      if (part.type !== "file" || !url || !mediaHashFromUri(url)) return part
      const pinned = await pinMediaBlob({ id: url, url })

      return { ...part, url: await blobDataUrl(pinned, part.mime ?? "application/octet-stream") }
    }),
  )
}
