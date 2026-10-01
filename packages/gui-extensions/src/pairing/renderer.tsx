import { lazy, Suspense } from "solid-js"
import { onIdle, Command, Layout, Native, Setting, type Setup } from "../sdk"
import { Pairing } from "./contract"

const setup: Setup = (ctx) => {
  if (!ctx.use(Native)) return
  const pairing = ctx.use(Pairing)
  const layout = ctx.use(Layout)
  const Page = lazy(() => import("./page"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  ctx.cleanup(onIdle(() => void Page.preload()))

  ctx.add(Setting, {
    id: "pairing",
    icon: "server",
    available: "desktop",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [
        { id: "pairing", title: ctx.t("title"), keywords: "pair device qr local" },
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
        <Page pairing={pairing} />
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
