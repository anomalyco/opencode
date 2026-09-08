import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Effect } from "effect"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { useSshServers } from "./context"
import { createSshReconnect } from "./reconnect-state"
import { DialogSsh } from "./dialog"

export function useSshReconnect() {
  const ssh = useSshServers()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  return createSshReconnect({
    items: () => ssh.data?.servers ?? [],
    start: (config) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const api = platform.sshServers
          if (!api) return
          yield* Effect.tryPromise(() => api.start(config))
          // Observe the admitted attempt before interpreting a stale disconnected
          // query snapshot as cancellation. IPC events and query notifications batch.
          yield* Effect.tryPromise(() => ssh.refetch())
        }),
      ),
    busy: () => !!dialog.active,
    prompt: (item) => void dialog.push(() => <DialogSsh config={item.config} promptOnly />),
    error: () => showToast({ variant: "error", title: language.t("common.requestFailed") }),
  })
}
