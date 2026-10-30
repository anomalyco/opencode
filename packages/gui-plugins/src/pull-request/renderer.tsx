import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { Command, ComposerPill, MenuItem, Panel, usePanel, type PanelTab, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { Loader } from "@opencode/ui/loader"
import type definition from "./index"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const View = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void View.preload()))

  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("title")
    },
  }

  const key = `${ctx.id}:main`

  const open = () => {
    const session = ctx.sessions.current()

    if (session) ctx.layout.open(key, session)
  }

  ctx.add(Command, () => ({ id: "open", title: ctx.t("open"), enabled: !!ctx.sessions.current(), run: open }))
  ctx.add(MenuItem, (): MenuItem | undefined => {
    const session = ctx.sessions.current()

    if (!session) return

    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("title"),
      icon: "github",
      run: open,
      opened: ctx.layout.state(key, session) !== "closed",
    }
  })
  ctx.add(ComposerPill, {
    id: "open",
    show: (input) =>
      input.session.project?.vcs === "git" ? { label: ctx.t("title"), icon: "github", run: open } : undefined,
  })
  ctx.add(Panel, {
    id: "main",
    region: "side",
    mobile: {
      get title() {
        return ctx.t("title")
      },
      order: 30,
      kind: "menu",
      icon: "github",
    },
    list: (input) => (input.open.includes("main") ? [tab] : []),
    render: (props) => {
      const frame = usePanel()

      return (
        <Show when={frame.visible()}>
          <Suspense
            fallback={
              <p role="status" class="p-4 flex items-center gap-2">
                <Loader />
                {ctx.t("loading")}
              </p>
            }
          >
            <View session={props.session} />
          </Suspense>
        </Show>
      )
    },
  })
}

export default setup
