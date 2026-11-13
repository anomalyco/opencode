import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, createKeyed, SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { Pairing } from "./contract"
import type definition from "./index"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  if (!ctx.desktop) return
  const layout = ctx.layout
  const servers = ctx.servers
  const pairing = ctx.use(Pairing)
  const Page = lazy(() => import("./page"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void Page.preload()))

  // The desktop's own server. Its ref is already authenticated in this window, so codes need no main process.
  const local = () =>
    servers
      .list()
      .map((id) => servers.get(id))
      .find((server) => server?.builtin)

  // Main reports the nearby phone asking to pair in its state. Each window shows it as a toast, wherever the user is,
  // replaced as the prompt changes and closed when it ends; only the code exchange's outcome gets a toast of its own.
  createKeyed(pairing, (client) => {
    createKeyed(
      // A copy: the state updates in place, so comparing it with itself would never see the offers change.
      () => {
        const prompt = client.state()?.nearby

        return prompt ? { ...prompt, offers: { ...prompt.offers } } : undefined
      },
      (prompt) => {
        const toast = prompt.approved
          ? ctx.toast.show({
              title: ctx.t("nearby.waiting", { device: prompt.device }),
              description: ctx.t("nearby.waitingDetail"),
              variant: "loading",
              persistent: true,
              actions: [{ label: ctx.t("common.cancel"), run: () => void client.cancelNearby(prompt.id).catch(() => undefined) }],
            })
          : ctx.toast.show({
              title: ctx.t("nearby.title", { device: prompt.device }),
              description: ctx.t("nearby.description", { code: `${prompt.code.slice(0, 3)} ${prompt.code.slice(3)}` }),
              icon: "server",
              persistent: true,
              actions: [
                { label: ctx.t("nearby.pair"), run: () => void client.approveNearby(prompt.id).catch(() => undefined) },
                { label: ctx.t("nearby.decline"), run: () => void client.cancelNearby(prompt.id).catch(() => undefined) },
                ...(prompt.offers.device
                  ? [{ label: ctx.t("nearby.snoozeDevice"), run: () => snooze(prompt.id, "device") }]
                  : []),
                ...(prompt.offers.all ? [{ label: ctx.t("nearby.snoozeAll"), run: () => snooze(prompt.id, "all") }] : []),
              ],
            })

        onCleanup(() => toast.dismiss())
      },
      {
        equals: (previous, next) =>
          previous.id === next.id &&
          previous.approved === next.approved &&
          previous.offers.device === next.offers.device &&
          previous.offers.all === next.offers.all,
      },
    )

    const snooze = (id: string, scope: "device" | "all") => void client.snoozeNearby({ id, scope }).catch(() => undefined)

    return client.on("nearbyResult", (result) =>
      ctx.toast.show(
        result.paired
          ? { title: ctx.t("nearby.paired", { device: result.device }), variant: "success" }
          : { title: ctx.t("nearby.failed", { device: result.device }), variant: "error" },
      ),
    )
  })

  ctx.add(SettingsPage, {
    id: "pairing",
    icon: "outline-pair",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      const pairingEntry = { id: "pairing", title: ctx.t("title"), keywords: "pair device qr phone remote" }

      // Remote access and the display setting exist only while pairing's main side answers.
      if (pairing().status !== "active") return [pairingEntry]

      return [
        pairingEntry,
        {
          id: "settings-remote-access",
          title: ctx.t("remote.title"),
          description: ctx.t("remote.description"),
          keywords: "internet tunnel opentunnel",
        },
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

  ctx.add(Command, () => ({
    id: "open",
    title: ctx.t("command.title"),
    group: ctx.t("command.category.server"),
    run: () => layout.settings("pairing"),
  }))
}

export default setup
