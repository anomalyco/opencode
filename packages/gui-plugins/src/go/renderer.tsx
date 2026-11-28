import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, createKeyed, SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type definition from "./index"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const layout = ctx.layout
  const servers = ctx.servers
  const Page = lazy(() => import("./page"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void Page.preload()))

  // The desktop's own server; on the web, the first server the app lists, as Home picks it.
  const server = () => {
    const refs = servers
      .list()
      .map((id) => servers.get(id))
      .filter((ref) => ref !== undefined)

    return refs.find((ref) => ref.builtin) ?? refs[0]
  }

  // Flags sync with a location the app opens, which settings may not have done yet.
  createKeyed(server, (ref) => void ref.data.location.flags.sync().catch(() => undefined))

  createKeyed(
    () => server()?.data.location.flag("go_settings"),
    () => {
      ctx.add(SettingsPage, {
        id: "go",
        group: "server",
        icon: ctx.icons.go,
        get title() {
          return ctx.t("title")
        },
        get entries() {
          return [{ id: "go", title: ctx.t("title"), keywords: "opencode go subscription plan usage limits" }]
        },
        render: () => (
          <Suspense>
            <Page server={server} />
          </Suspense>
        ),
      })

      ctx.add(Command, () => ({ id: "open", title: ctx.t("command.title"), run: () => layout.settings("go") }))
    },
  )
}

export default setup
