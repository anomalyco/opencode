import { showToast } from "@opencode/ui/toast"
import { lazy, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { App, Dialogs, Menu, onIdle, Server, Style, type ServerEntry, type ServerState, type Setup } from "../sdk"
import { Wsl, type WslServerItem } from "./contract"

const loadDialog = () => import("./dialog")

const setup: Setup = (ctx) => {
  if (ctx.use(App).platform !== "desktop") return
  const remote = ctx.use(Wsl)
  const dialog = ctx.use(Dialogs)
  const Row = lazy(() => import("./row"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  ctx.cleanup(onIdle(() => void Row.preload()))
  const state = () => remote()?.state()
  const styled = { added: false }
  // Row actions of one server share a pending state, like one request per row.
  const [requests, setRequests] = createStore<Record<string, number>>({})
  const pending = (key: string) => (requests[key] ?? 0) > 0
  const request = (key: string, action: () => Promise<unknown>) => {
    setRequests(key, (count = 0) => count + 1)
    void action()
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: ctx.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setRequests(key, (count = 1) => count - 1))
  }
  const byKey = (key: string) => state()?.servers.find((item) => `wsl:${item.config.distro}` === key)

  const add = () => {
    const api = remote()
    if (!api) return
    void loadDialog().then((module) => {
      if (ctx.signal.aborted) return
      if (!styled.added) ctx.add(Style, module.css)
      styled.added = true
      dialog.push(() => <module.DialogAddWslServer api={api} state={state} />)
    })
  }

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
      remove: () => remote()?.removeServer({ id: item.config.id }) ?? Promise.resolve(),
      row: (row) => (
        <Suspense>
          <Row row={row} distro={item.config.distro} state={state} api={remote} pending={pending} request={request} />
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

  ctx.add(Menu, (): Menu => ({ menu: "server.add", id: "add", title: ctx.t("server.add"), order: 2, run: add }))
  ctx.add(
    Menu,
    (): Menu => ({
      menu: "server.row",
      id: "retry",
      title: ctx.t("server.retryStart"),
      when: (key) => {
        const kind = byKey(key)?.runtime.kind
        return kind === "failed" || kind === "stopped"
      },
      run: (key) => {
        const item = byKey(key)
        const api = remote()
        if (item && api) request(key, () => api.startServer({ id: item.config.id }))
      },
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
