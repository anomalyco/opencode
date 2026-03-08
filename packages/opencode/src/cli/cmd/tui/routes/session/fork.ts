import type { PromptInfo } from "@tui/component/prompt/history"
import type { useKV } from "@tui/context/kv"
import type { useRoute } from "@tui/context/route"
import type { useSDK } from "@tui/context/sdk"
import type { useSync } from "@tui/context/sync"
import { forkCommand, forkKey, tmuxReady } from "@tui/util/fork-pane"
import { useToast } from "@tui/ui/toast"
import { Process } from "@/util/process"

function prompt(parts: ReturnType<typeof useSync>["data"]["part"][string] | undefined): PromptInfo | undefined {
  if (!parts?.length) return
  return parts.reduce(
    (agg, part) => {
      if (part.type === "text") {
        if (!part.synthetic) agg.input += part.text
      }
      if (part.type === "file") agg.parts.push(part)
      return agg
    },
    { input: "", parts: [] as PromptInfo["parts"] },
  )
}

export async function forkSession(input: {
  sessionID: string
  messageID: string
  attachURL?: string
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  kv: ReturnType<typeof useKV>
  route: ReturnType<typeof useRoute>
  toast: ReturnType<typeof useToast>
}) {
  const result = await input.sdk.client.session.fork({
    sessionID: input.sessionID,
    messageID: input.messageID,
  })
  const next = result.data?.id
  if (!next) {
    input.toast.show({ message: "Failed to fork session", variant: "error" })
    return
  }

  const initialPrompt = prompt(input.sync.data.part[input.messageID])
  const tmuxPath = Bun.which("tmux")
  const dir = input.sync.data.path.directory || process.cwd()
  const ready = tmuxReady(process.env, tmuxPath)

  if (ready) {
    const key = forkKey(next)
    if (initialPrompt) input.kv.set(key, initialPrompt)
    const proc = await Process.run(
      ["tmux", "split-window", "-c", dir, ...forkCommand({ sessionID: next, attachURL: input.attachURL, dir })],
      {
        nothrow: true,
      },
    )
    if (proc.code === 0) {
      input.toast.show({ message: "Fork opened in a new tmux pane", variant: "success" })
      return
    }
    if (initialPrompt) input.kv.set(key, null)
    input.toast.show({ message: "Failed to open tmux pane, opening fork in current view", variant: "warning" })
  }

  if (!ready) {
    input.toast.show({ message: "tmux not detected, opening fork in current view", variant: "warning" })
  }

  input.route.navigate({
    sessionID: next,
    type: "session",
    initialPrompt,
  })
}
