import { lazy, onCleanup, Suspense } from "solid-js"
import { onIdle, Command, SettingsPage, type Setup } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  if (!ctx.desktop) return
  const layout = ctx.layout
  const servers = ctx.servers
  const pairing = ctx.uses.pairing
  const Page = lazy(() => import("./page"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void Page.preload()))

  // The desktop's own server. Its ref is already authenticated in this window, so codes need no main process.
  const local = () =>
    servers
      .list()
      .map((id) => servers.get(id))
      .find((server) => server?.builtin)

  ctx.add(SettingsPage, {
    id: "pairing",
    icon: "server",
    available: "desktop",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      const pairingEntry = { id: "pairing", title: ctx.t("title"), keywords: "pair device qr local" }

      // The display setting exists only while pairing's main side answers.
      if (pairing().status !== "active") return [pairingEntry]

      return [
        pairingEntry,
        {
          id: "settings-keep-screen-active",
          title: ctx.t("screenActive.title"),
          description: ctx.t("screenActive.description"),
          keywords: "display sleep awake local",
        },
      ]
    },
    render: () => (
      <Suspense>
        <Page server={local} pairing={pairing} />
      </Suspense>
    ),
  })

  ctx.add(Command, {
    id: "open",
    get title() {
      return ctx.t("command.title")
    },
    get group() {
      return ctx.t("command.category.server")
    },
    run: () => layout.settings("pairing"),
  })
}

export default setup
