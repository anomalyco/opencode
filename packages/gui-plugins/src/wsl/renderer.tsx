import { showToast } from "@opencode/ui/toast"
import { lazy, onCleanup, Suspense } from "solid-js"
import { MenuItem, Server, Style, type ServerEntry, type ServerState, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { Wsl, type WslServerItem } from "./contract"
import { wslRowView } from "./row-view"
import type definition from "./index"

const loadDialog = () => import("./dialog")

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  if (ctx.app.platform !== "desktop") return
  const ipc = ctx.use(Wsl)
  const dialog = ctx.dialogs
  const Row = lazy(() => import("./row"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void Row.preload()))

  const client = () => {
    const live = ipc()

    return live.status === "active" ? live.value : undefined
  }

  // Without its main side, loading or gone, every action fails as WSL being unavailable, as the add dialog shows.
  const api = () => {
    const live = ipc()

    if (live.status === "active") return live.value
    throw new Error(ctx.t("error.unavailable"))
  }

  const state = () => client()?.state()
  const styled = { added: false }

  // What a row can do follows main's state; a request only reports its failure.
  const run = (action: () => Promise<void>) => {
    void Promise.try(action).catch((cause: unknown) =>
      showToast({
        variant: "error",
        title: ctx.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      }),
    )
  }

  const byKey = (key: string) => state()?.servers.find((item) => `wsl:${item.config.distro}` === key)

  const add = () =>
    void loadDialog().then((module) => {
      if (ctx.signal.aborted) return

      if (!styled.added) ctx.add(Style, module.css)
      styled.added = true
      dialog.open(() => <module.DialogAddWslServer api={client()} state={state()} />)
    })

  const entry = (item: WslServerItem): ServerEntry => {
    const runtime = item.runtime

    return {
      id: item.config.distro,
      name: item.config.distro,
      label: ctx.t("server.label"),
      state: serverState(item),
      // A distro joins the app's servers once its server is up; settings lists it before that.
      listed: runtime.kind === "ready",
      http: runtime.kind === "ready" ? { url: runtime.url, password: runtime.password ?? undefined } : undefined,
      remove: () => Promise.try(() => api().removeServer({ id: item.config.id })),
      row: (row) => (
        <Suspense>
          <Row row={row} distro={item.config.distro} state={state} api={client} run={run} />
        </Suspense>
      ),
    }
  }

  ctx.add(Server, () => {
    const current = state()

    return {
      ready: current !== undefined,
      order: 1,
      entries: (current?.servers ?? []).map(entry),
    }
  })

  ctx.add(MenuItem, (): MenuItem => ({ menu: "server.add", id: "add", title: ctx.t("server.add"), order: 2, run: add }))
  ctx.add(
    MenuItem,
    (): MenuItem => ({
      menu: "server.row",
      id: "retry",
      title: ctx.t("server.retryStart"),
      when: (key) => {
        const item = byKey(key)

        return !!item && wslRowView(state(), item.config.distro).retry
      },
      run: (key) =>
        run(async () => {
          const wsl = api()
          const item = byKey(key)

          if (item) await wsl.startServer({ id: item.config.id })
        }),
    }),
  )
}

function serverState(item: WslServerItem): ServerState {
  if (item.runtime.kind === "ready") return "ready"

  if (item.runtime.kind === "starting") return "starting"

  if (item.runtime.kind === "failed") return "failed"

  return "stopped"
}

export default setup
