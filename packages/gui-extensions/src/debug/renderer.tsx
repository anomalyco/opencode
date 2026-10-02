import { createSignal, lazy, Show, Suspense } from "solid-js"
import { App, Command, Slot, Status, type Setup } from "../sdk"

const setup: Setup = (ctx) => {
  const DebugBar = lazy(() => import("./bar"))
  const channel = ctx.use(App).channel
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

  ctx.add(Slot, {
    at: "shell.bottom",
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
    Status,
    (): Status => ({
      id: "toggle",
      placement: "channel",
      label: ctx.t("status.toggle"),
      pressed: visible(),
      run: toggle,
    }),
  )
}

export default setup
