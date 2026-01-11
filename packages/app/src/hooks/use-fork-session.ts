import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { extractPromptFromParts } from "@/utils/prompt"
import { base64Encode } from "@opencode-ai/util/encode"

export function useForkSession() {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const sdk = useSDK()
  const prompt = usePrompt()

  return (messageID: string) => {
    const sessionID = params.id
    if (!sessionID) return

    const parts = sync.data.part[messageID] ?? []
    const restored = extractPromptFromParts(parts, { directory: sdk.directory })

    sdk.client.session.fork({ sessionID, messageID }).then((forked) => {
      if (!forked.data) return
      navigate(`/${base64Encode(sdk.directory)}/session/${forked.data.id}`)
      requestAnimationFrame(() => {
        prompt.set(restored)
      })
    })
  }
}
