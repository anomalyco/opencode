import type { useSDK } from "../context/sdk"
import type { useSync } from "../context/sync"
import type { useToast } from "../ui/toast"
import { modeSpec, reconcileQueue, type ModeValue } from "../util/auto-mode"
import { errorMessage } from "../util/error"

type Deps = {
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
}

/**
 * The single path for changing auto mode, used by the picker, the cycle
 * keybind and the individual toggles. They used to each write config on their
 * own, which is how the indicator and the actual behaviour drift apart.
 */
export async function applyAutoMode(deps: Deps, value: ModeValue, guidance?: string): Promise<void> {
  const { sdk, sync, toast } = deps
  const mode = modeSpec(value)

  try {
    await sdk.client.global.config.update(
      { config: { auto_mode: mode.auto_mode, auto_continue: mode.auto_continue } },
      { throwOnError: true },
    )
    // Read back through the SAME endpoint the rest of the app reads
    // (`config.get`, the effective merged config for this workspace) rather
    // than `global.config.get`. They are different views: refreshing from the
    // global file made the indicator show a value that the next bootstrap —
    // triggered by something as ordinary as sending a prompt — would overwrite
    // with the workspace's view, so Auto silently flipped back to Manual.
    const refreshed = await sdk.client.config.get({}, { throwOnError: true })
    sync.set("config", refreshed.data!)
  } catch {
    toast.show({ variant: "warning", message: "Failed to update auto mode setting" })
    return
  }

  try {
    const result = await reconcileQueue({
      mode: value,
      list: async () => (await sdk.client.loop.list()).data ?? [],
      start: async () =>
        (
          await sdk.client.loop.create(
            { prompt: "", mode: "queue", queueGuidance: guidance?.trim() || undefined },
            { throwOnError: true },
          )
        ).data,
      cancel: async (loopID) => {
        await sdk.client.loop.cancel({ loopID }).catch(() => undefined)
      },
    })

    if (result.started) {
      toast.show({
        variant: "success",
        message: `Auto — working the openspec backlog (run ${result.started.id}). It never pushes; type a message to take over.`,
      })
      return
    }
    if (result.stopped > 0) {
      toast.show({
        variant: "success",
        message: `${mode.title} — stopped ${result.stopped} backlog run${result.stopped === 1 ? "" : "s"}. Selecting Auto resumes where it left off.`,
      })
      return
    }
    toast.show({ variant: "success", message: `${mode.title} — ${mode.footer}` })
  } catch (error) {
    // The flags are already saved; only the backlog run failed to start or
    // stop, so say which half went wrong rather than implying nothing changed.
    toast.show({
      title: `${mode.title} set, but the backlog run did not change`,
      message: errorMessage(error),
      variant: "warning",
    })
  }
}
