import { showToast, toaster } from "@opencode/ui/toast"
import { createSignal, lazy, Show, Suspense } from "solid-js"
import { createKeyed, Command, Slot, TitlebarItem, type Setup } from "../sdk"
import type Debug from "./index"

const setup: Setup<typeof Debug> = (ctx) => {
  const DebugBar = lazy(() => import("./bar"))
  const channel = ctx.build.channel
  // Window-local; every window starts with the bar hidden.
  const [visible, setVisible] = createSignal(false)

  const toggle = () => {
    setVisible((value) => !value)
  }

  ctx.add(
    Command,
    (): Command => ({
      id: "toggle",
      title: ctx.t("command.toggle"),
      group: ctx.t("command.category.view"),
      run: toggle,
    }),
  )

  const desktop = ctx.desktop

  // Offered only while main answers: never on the web, and not while the extension restarts.
  if (desktop)
    createKeyed(ctx.uses.heap, (heap) =>
      ctx.add(Command, {
        id: "heap",
        get title() {
          return ctx.t("command.heap")
        },
        get description() {
          return ctx.t("command.heap.description")
        },
        get group() {
          return ctx.t("command.category.settings")
        },
        run: async () => {
          const loading = showToast({ variant: "loading", title: ctx.t("heap.loading"), persistent: true })

          const result = await heap.write({ signal: ctx.signal }).catch(() => undefined)

          toaster.dismiss(loading)

          if (ctx.signal.aborted) return

          if (!result) return void showToast({ variant: "error", title: ctx.t("heap.failed") })

          showToast({
            variant: result.complete ? "success" : "error",
            title: ctx.t(result.complete ? "heap.done" : "heap.partial"),
            description: result.directory,
            persistent: true,
            actions: [{ label: ctx.t("heap.reveal"), onClick: () => void desktop.reveal(result.directory) }],
          })
        },
      }),
    )

  ctx.add(Slot, {
    at: "window.bottom",
    render: () => (
      <Show when={visible()}>
        <Suspense>
          <DebugBar diagnostics={import.meta.env.DEV} inline />
        </Suspense>
      </Show>
    ),
  })

  if (channel !== "dev" && channel !== "local") return
  ctx.add(
    TitlebarItem,
    (): TitlebarItem => ({
      id: "toggle",
      placement: "channel",
      label: ctx.t("status.toggle"),
      pressed: visible(),
      run: toggle,
    }),
  )
}

export default setup
