import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogMajorUpdate, preloadMajorUpdateImage } from "@/components/dialog-major-update"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { MajorUpdateState } from "@/updater"
import { Persist, persisted } from "@/utils/persist"

export const LATER_DURATION = 7 * 24 * 60 * 60 * 1000
// The offer opens by itself only this soon after the app starts. Later than this, the user is already working.
export const LAUNCH_WINDOW = 30 * 1000

// Later hides the OpenCode 2.0 offer for a week, like Dismiss in the TUI. Closing the dialog any other way doesn't.
// Once the user chose to upgrade on quit there is nothing left to offer, so the titlebar shows nothing.
export function majorUpdateVisible(status: MajorUpdateState["status"], laterUntil: number | undefined, now: number) {
  if (status !== "ready") return false
  return laterUntil === undefined || now >= laterUntil
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
      createStore({ laterUntil: undefined as number | undefined }),
    )
    const [state, setState] = createStore({ now: Date.now(), prompted: false })
    const started = performance.now()
    const clock = setInterval(() => setState("now", Date.now()), 10 * 60 * 1000)
    onCleanup(() => clearInterval(clock))

    const status = () => platform.updater?.major?.state().status ?? "unavailable"
    const offered = () => status() === "ready" || status() === "scheduled"
    const visible = createMemo(() => ready() && majorUpdateVisible(status(), store.laterUntil, state.now))

    // Starts while OpenCode 2 downloads, so the image is ready long before anything opens the dialog.
    const image = createMemo<Promise<HTMLImageElement> | undefined>((previous) => {
      if (previous) return previous
      if (status() !== "unavailable") return preloadMajorUpdateImage()
    })

    const open = async () => {
      const major = platform.updater?.major
      if (!major || !offered()) return
      const element = await image()
      dialog.show(() => (
        <DialogMajorUpdate
          major={major}
          image={element}
          later={() => {
            const at = Date.now()
            setStore("laterUntil", at + LATER_DURATION)
            setState("now", at)
          }}
        />
      ))
    }

    // The TUI only shows a notice. The desktop app also opens the offer once per launch, and only right after the app
    // starts. A download that finishes later, or a week that runs out, brings the titlebar pill and never a dialog
    // over the user's work.
    createEffect(() => {
      if (state.prompted || !ready() || status() !== "ready") return
      setState("prompted", true)
      if (!visible() || performance.now() - started > LAUNCH_WINDOW) return
      void platform.updater?.major?.prompt().then((first) => {
        if (first && !dialog.active) void open()
      })
    })

    command.register("major-update", () =>
      offered()
        ? [
            {
              id: "update.open",
              title: language.t("toast.update.title"),
              category: language.t("command.category.settings"),
              onSelect: () => void open(),
            },
          ]
        : [],
    )

    return { status, offered, visible, open }
  },
})
