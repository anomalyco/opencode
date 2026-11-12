import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogMajorUpdate } from "@/components/dialog-major-update"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { MajorUpdateState } from "@/updater"
import { Persist, persisted } from "@/utils/persist"

export const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000

// Dismissing the OpenCode 2.0 offer hides it for a week, like the TUI. Closing the dialog any other way doesn't.
export function majorUpdateVisible(
  status: MajorUpdateState["status"],
  dismissedUntil: number | undefined,
  now: number,
) {
  if (status === "unavailable") return false
  if (status === "installing" || status === "installed") return true
  return dismissedUntil === undefined || now >= dismissedUntil
}

export const { use: useMajorUpdate, provider: MajorUpdateProvider } = createSimpleContext({
  name: "MajorUpdate",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const dialog = useDialog()
    const command = useCommand()
    const language = useLanguage()
    const [store, setStore, _, ready] = persisted(
      Persist.global("update.major"),
      createStore({ dismissedUntil: undefined as number | undefined }),
    )
    const [state, setState] = createStore({ now: Date.now(), prompted: false })
    const clock = setInterval(() => setState("now", Date.now()), 10 * 60 * 1000)
    onCleanup(() => clearInterval(clock))

    const status = () => platform.updater?.major?.state().status ?? "unavailable"
    const visible = createMemo(() => ready() && majorUpdateVisible(status(), store.dismissedUntil, state.now))

    const open = () => {
      const major = platform.updater?.major
      if (!major) return
      dialog.show(() => (
        <DialogMajorUpdate
          major={major}
          dismiss={() => {
            const at = Date.now()
            setStore("dismissedUntil", at + DISMISS_DURATION)
            setState("now", at)
          }}
        />
      ))
    }

    // The TUI only shows a notice. The desktop app also opens the offer, once per launch, when the first check reports
    // it. A snooze that runs out while the app is open brings back the titlebar pill but never opens a dialog mid-work.
    createEffect(() => {
      if (state.prompted || !ready() || status() !== "available") return
      setState("prompted", true)
      if (!visible()) return
      void platform.updater?.major?.prompt().then((first) => {
        if (first && !dialog.active) open()
      })
    })

    command.register("major-update", () =>
      status() === "unavailable"
        ? []
        : [
            {
              id: "update.open",
              title: language.t("toast.update.title"),
              category: language.t("command.category.settings"),
              onSelect: open,
            },
          ],
    )

    return { status, visible, open }
  },
})
