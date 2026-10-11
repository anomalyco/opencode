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

// Skipping an OpenCode 1 version hides it until a newer one ships; dismissing the OpenCode 2.0 offer hides it for a week.
export function visibleNotice(
  notice: UpdateNotice | undefined,
  hidden: { readonly skippedVersion?: string; readonly dismissedUntil?: number },
  now: number,
) {
  if (!notice) return undefined
  if (notice.type === "major")
    return hidden.dismissedUntil !== undefined && now < hidden.dismissedUntil ? undefined : notice
  if (hidden.skippedVersion && !isVersionGreater(notice.version, hidden.skippedVersion)) return undefined
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
      return visibleNotice(
        available(),
        { skippedVersion: kv.get("skipped_version"), dismissedUntil: kv.get("update_dismissed_until") },
        now(),
      )
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
          skip={(version) => kv.set("skipped_version", version)}
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

export function isVersionGreater(left: string, right: string) {
  const parse = (value: string) => {
    const [core, prerelease] = value.replace(/^v/, "").split("-", 2)
    return { core: core.split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index++) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (difference) return difference > 0
  }
  if (a.prerelease === b.prerelease) return false
  if (!a.prerelease) return true
  if (!b.prerelease) return false
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true }) > 0
}
