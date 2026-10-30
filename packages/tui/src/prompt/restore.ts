import { useClient } from "../context/client"
import { useToast } from "../ui/toast"
import { isMissingMedia } from "../util/media"
import { restoredPromptInput, type ProjectedPrompt } from "./codec"
import type { PromptInfo } from "./history"

/**
 * Reads a sent prompt back for the composer, with its images as bytes. Reading before an undo or revert means a failed
 * read changes nothing, and the draft owns its bytes before the server releases the blob: an inbox
 * cancel releases it at once, a revert once it's committed on the next submit. An image the server no longer has is
 * left out with a warning, so it can't block the rewind; `allowMissing: false` rejects instead, as a fork without its
 * prompt is not what was asked for. Any other failed read rejects, since that image may still exist.
 */
export function usePromptRestore() {
  const client = useClient()
  const toast = useToast()
  return async (input: ProjectedPrompt, options?: { allowMissing?: false }): Promise<PromptInfo> => {
    let missing = 0
    const prompt = await restoredPromptInput(input, (uri) =>
      client.media.read(uri).catch((error) => {
        if (options?.allowMissing === false || !isMissingMedia(error)) throw error
        missing++
        return undefined
      }),
    )
    if (missing)
      toast.show({
        message:
          missing === 1
            ? "An image in this message is no longer stored, so it can't be restored"
            : `${missing} images in this message are no longer stored, so they can't be restored`,
        variant: "warning",
      })
    return { ...prompt, pasted: [] }
  }
}
