import { base64Encode } from "@opencode-ai/util/encode"
import type { Prompt } from "@/context/prompt"

type ForkData = { id: string }
type ForkInput = { sessionID: string; messageID: string }
type ForkResult = { data?: ForkData }

export async function forkSession(opts: {
  fork: (input: ForkInput) => Promise<ForkResult>
  sessionID: string
  messageID: string
  prompt: Prompt
  directory: string
  fail: (message?: string) => void
  navigate: (href: string) => void
  set: (prompt: Prompt, next: { dir: string; id: string }) => void
  done?: () => void
}) {
  const dir = base64Encode(opts.directory)

  await opts
    .fork({ sessionID: opts.sessionID, messageID: opts.messageID })
    .then((res) => {
      const id = res.data?.id
      if (!id) {
        opts.fail()
        return
      }
      opts.done?.()
      opts.set(opts.prompt, { dir, id })
      opts.navigate(`/${dir}/session/${id}`)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      opts.fail(message)
    })
}
