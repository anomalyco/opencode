import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import { useExit } from "./exit"
import { useDialog } from "../ui/dialog"
import { errorMessage } from "../util/error"
import { DialogUpdate } from "../component/dialog-update"

export type UpdateTarget = { readonly type: "latest"; readonly version: string } | { readonly type: "major" }

export type UpdateState =
  | { readonly type: "installing"; readonly target: UpdateTarget }
  | { readonly type: "installed"; readonly target: UpdateTarget }
  | { readonly type: "failed"; readonly target: UpdateTarget; readonly message: string }

// A newer OpenCode 1 release wins; OpenCode 2.0 is only suggested once OpenCode 1 is up to date.
export type UpdateNotice = { readonly type: "available"; readonly version: string } | { readonly type: "major" }

// Implemented by the CLI process so checks and installs run against this machine's installation.
export type UpdateSource = {
  readonly subscribe: (notify: (notice: UpdateNotice) => void) => () => void
  readonly check: () => Promise<{ readonly current: string; readonly latest?: string }>
  readonly apply: (target: UpdateTarget) => Promise<void>
}

export const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000

// Dismissing hides the notice for a week, whichever update it was for.
export function visibleNotice(notice: UpdateNotice | undefined, dismissedUntil: number | undefined, now: number) {
  if (!notice) return undefined
  if (dismissedUntil !== undefined && now < dismissedUntil) return undefined
  return notice
}

export const MAJOR_INSTRUCTIONS = "https://opencode.ai/v2/docs"

export const { use: useUpdateNotification, provider: UpdateNotificationProvider } = createSimpleContext({
  name: "UpdateNotification",
  init: (props: { updater?: UpdateSource }) => {
    const kv = useKV()
    const dialog = useDialog()
    const exit = useExit()
    const [available, setAvailable] = createSignal<UpdateNotice>()
    const [state, setState] = createSignal<UpdateState>()
    const [now, setNow] = createSignal(Date.now())
    const clock = setInterval(() => setNow(Date.now()), 10 * 60 * 1000)
    onCleanup(() => clearInterval(clock))

    // Checks only announce a version. Installing always goes through /update.
    onMount(() => {
      if (!props.updater) return
      onCleanup(props.updater.subscribe(setAvailable))
    })

    const notification = createMemo(() => {
      const current = state()
      if (current?.type === "installed") return current
      return visibleNotice(available(), kv.get("update_dismissed_until"), now())
    })

    const install = async (target: UpdateTarget) => {
      const updater = props.updater
      if (!updater || state()?.type === "installing") return
      setState({ type: "installing", target })
      await updater.apply(target).then(
        () => setState({ type: "installed", target }),
        (error: unknown) => {
          const message = errorMessage(error)
          setState({
            type: "failed",
            target,
            message:
              target.type === "major" && !message.includes(MAJOR_INSTRUCTIONS)
                ? `${message}\nTo install OpenCode 2.0 manually, see ${MAJOR_INSTRUCTIONS}`
                : message,
          })
        },
      )
    }

    const open = () => {
      const updater = props.updater
      if (!updater) return
      dialog.replace(() => (
        <DialogUpdate
          check={updater.check}
          state={state}
          install={install}
          dismiss={() => {
            const at = Date.now()
            kv.set("update_dismissed_until", at + DISMISS_DURATION)
            setNow(at)
          }}
          restart={() => exit()}
        />
      ))
    }

    return {
      notification,
      open: props.updater ? open : undefined,
    }
  },
})
