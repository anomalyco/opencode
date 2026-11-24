import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogMajorUpdate, MAJOR_INSTRUCTIONS, preloadMajorUpdateImage } from "@/components/dialog-major-update"
import { useCommand } from "@/context/command"
import { useHighlights } from "@/context/highlights"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { MajorUpdatePrompt, MajorUpdateState } from "@/updater"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"

export const LATER_DURATION = 7 * 24 * 60 * 60 * 1000

// Later hides the OpenCode 2.0 offer for a week, like Dismiss in the TUI. Closing the dialog any other way doesn't.
// Once the user chose to upgrade there is nothing left to offer, so the titlebar shows nothing.
export function majorUpdateVisible(status: MajorUpdateState["status"], laterUntil: number | undefined, now: number) {
  if (status !== "ready") return false
  return laterUntil === undefined || now >= laterUntil
}

// The offer exists from the moment OpenCode 2 is downloaded, whatever the user has chosen since.
export function majorUpdateOffered(status: MajorUpdateState["status"]) {
  return status !== "unavailable" && status !== "downloading"
}

// Whether a window opens the offer by itself, once the app has answered its prompt. An offer the user asked for always
// opens. The one right after launch gives way to Later, to release notes for an OpenCode 1 update, and to any dialog
// that is already open. The titlebar still offers OpenCode 2 then.
export function majorUpdateAutoOpen(input: {
  prompt: MajorUpdatePrompt
  visible: boolean
  notes: boolean
  dialog: boolean
}) {
  if (input.prompt === "asked") return true
  if (input.prompt !== "launch") return false
  return input.visible && !input.notes && !input.dialog
}

export const { use: useMajorUpdate, provider: MajorUpdateProvider } = createSimpleContext({
  name: "MajorUpdate",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const dialog = useDialog()
    const command = useCommand()
    const language = useLanguage()
    const highlights = useHighlights()
    const [store, setStore, _, ready] = persisted(
      Persist.global("update.major"),
      createStore({ laterUntil: undefined as number | undefined }),
    )
    const [state, setState] = createStore({ now: Date.now(), prompted: false, failed: false })
    const clock = setInterval(() => setState("now", Date.now()), 10 * 60 * 1000)
    onCleanup(() => clearInterval(clock))

    const status = () => platform.updater?.major?.state().status ?? "unavailable"
    const offered = () => majorUpdateOffered(status())
    const visible = createMemo(() => ready() && majorUpdateVisible(status(), store.laterUntil, state.now))

    // Starts while OpenCode 2 downloads, so the image is ready long before anything opens the dialog.
    const image = createMemo<Promise<HTMLImageElement> | undefined>((previous) => {
      if (previous) return previous
      if (status() !== "unavailable") return preloadMajorUpdateImage()
    })

    // `auto` is the offer that opens by itself. `stack` keeps the dialog that asked for the offer open underneath.
    const open = async (input?: { auto?: boolean; stack?: boolean }) => {
      const major = platform.updater?.major
      if (!major || !offered()) return
      const element = await image()
      // While the image decodes, the offer can be withdrawn and another dialog can open.
      if (!offered() || (input?.auto && dialog.active)) return
      const card = () => (
        <DialogMajorUpdate
          major={major}
          image={element}
          later={() => {
            const at = Date.now()
            setStore("laterUntil", at + LATER_DURATION)
            setState("now", at)
          }}
          failed={() => setState("failed", true)}
        />
      )
      if (input?.stack) return dialog.push(card)
      return dialog.show(card)
    }

    // A failed restart or upgrade on quit and the state it leaves behind arrive from the app separately, so the toast
    // waits until that state is here.
    createEffect(() => {
      const current = platform.updater?.major?.state()
      if (!state.failed || !current || current.status === "installing" || current.status === "scheduling") return
      setState("failed", false)
      // A restart can fail after the servers have shut down. The app then does not work until it restarts, so the
      // toast stays and offers that.
      const stopped = (current.status === "ready" || current.status === "scheduled") && current.stopped === true
      showToast({
        title: language.t("dialog.update.major.failed"),
        description: language.t("dialog.update.major.manual", { url: MAJOR_INSTRUCTIONS }),
        persistent: stopped,
        actions: [
          ...(stopped
            ? [{ label: language.t("error.page.action.restart"), onClick: () => void platform.restart() }]
            : []),
          { label: language.t("common.open"), onClick: () => platform.openExternal(MAJOR_INSTRUCTIONS) },
        ],
      })
    })

    // The TUI only shows a notice. The desktop app also opens the offer once per launch, and only right after the app
    // starts. The app decides which window that is and whether it is still soon enough, so a window that opens,
    // reloads or changes its layout later never opens a dialog over the user's work. The titlebar offers it instead.
    createEffect(() => {
      if (state.prompted || !ready() || !highlights.started() || !offered()) return
      setState("prompted", true)
      void platform.updater?.major?.prompt().then((prompt) => {
        if (
          !majorUpdateAutoOpen({
            prompt,
            visible: visible(),
            notes: highlights.notes(),
            dialog: dialog.active !== undefined,
          })
        )
          return
        void open({ auto: prompt === "launch" })
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
