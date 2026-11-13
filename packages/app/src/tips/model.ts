import { showToast, toaster } from "@opencode/ui/toast"
import { Schema } from "effect"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { FIRST_TIP_DELAY_MS, selectTip, TIP_INTERVAL_MS, type Tip } from "./queue"

const STARTUP_DELAY = 2 * 60 * 1000

const History = Persistence.struct({
  current: Schema.String,
  shownAt: Schema.Finite,
  dismissed: Persistence.array(Schema.String),
  dismissedAt: Schema.Finite,
  firstSeen: Persistence.fallback(Schema.Finite, () => 0),
})

export function createTipToasts() {
  const global = useGlobal()
  const servers = useServers()
  const language = useLanguage()
  const platform = usePlatform()

  const server = createMemo(() => {
    const conn = servers.visible.find(servers.current) ?? servers.visible[0]

    return conn && global.serverCtx(ServerConnection.key(conn))
  })

  const location = () => server()?.data.location
  const [awake, setAwake] = createSignal(false)
  const startup = setTimeout(() => setAwake(true), STARTUP_DELAY)
  onCleanup(() => clearTimeout(startup))
  createEffect(() => {
    const ctx = server()

    if (!awake() || ctx?.sdk.connection.status() !== "connected") return
    const location = ctx.data.location
    void location
      .syncInfo()
      .then(() => location.mcp.server.sync())
      .catch(() => undefined)
  })

  const tips: Tip[] = [
    {
      id: "browse",
      title: "tips.browse.title",
      description: "tips.browse.description",
      when: () =>
        !location()
          ?.mcp.server.list()
          ?.some((item) => item.name === "browse"),
      action: {
        label: "tips.browse.install",
        run: () => platform.openExternal(
            "https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg?utm_source=opencode-desktop&utm_campaign=tip-browse",
          ),
      },
    },
    {
      id: "hex",
      title: "tips.hex.title",
      description: "tips.hex.description",
      action: {
        label: "tips.hex.install",
        // anoma.ly/hex 404s with a query string; the trailing slash is required.
        run: () =>
          platform.openExternal("https://anoma.ly/hex/?utm_source=opencode-desktop&utm_campaign=tip-hex"),
      },
    },
  ]

  const [history, setHistory, , loaded] = persisted({ ...Persist.global("tips.queue"), sync: true }, History, {
    current: "",
    shownAt: 0,
    dismissed: [],
    dismissedAt: 0,
    firstSeen: 0,
  })

  createEffect(() => {
    if (loaded() && !history.firstSeen) setHistory("firstSeen", Date.now())
  })

  const [tick, setTick] = createSignal(0)

  const selected = createMemo(() => {
    if (!awake() || !loaded() || !location()?.mcp.server.list()) return
    tick()
    const now = Date.now()

    const times = [
      Math.max(history.shownAt, history.dismissedAt) + TIP_INTERVAL_MS,
      history.firstSeen + FIRST_TIP_DELAY_MS,
      ...tips.flatMap((tip) => [tip.start ?? 0, tip.end ?? 0]),
    ]

    const next = Math.min(...times.filter((time) => time > now))

    if (Number.isFinite(next)) {
      const timer = setTimeout(() => setTick((n) => n + 1), Math.min(next - now, 2 ** 31 - 1))
      onCleanup(() => clearTimeout(timer))
    }

    return selectTip(tips, history, now)
  })

  createEffect(() => {
    const tip = selected()

    if (!tip) return

    const handled = () =>
      setHistory({ current: "", dismissed: [...history.dismissed, tip.id], dismissedAt: Date.now() })

    global.notifications.tip(() => {
      if (history.current !== tip.id) setHistory({ current: tip.id, shownAt: Date.now() })
      const action = tip.action

      const id = showToast({
        persistent: true,
        title: language.t(tip.title),
        description: language.t(tip.description),
        onDismiss: handled,
        actions: action && [
          {
            label: language.t(action.label),
            onClick: () => {
              handled()
              action.run()
            },
          },
        ],
      })

      return () => toaster.dismiss(id)
    })
  })
}
