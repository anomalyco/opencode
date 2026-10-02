import { showToast } from "@opencode/ui/toast"
import { createEffect, createMemo, createRoot, lazy, Suspense, untrack, type JSX } from "solid-js"
import { App, Command, Dialogs, Layout, Menu, onIdle, Server, Style, type ServerEntry, type Setup } from "../sdk"
import { Ssh, type SshConfig, type SshItem } from "./contract"
import { SshCover, type SshOffer } from "./cover"
import { sshName, sshServerState } from "./name"
import { createSshController } from "./state"

const loadDialog = () => import("./dialog")

const setup: Setup = (ctx) => {
  const app = ctx.use(App)
  // SSH lives in the desktop main process.
  if (app.platform !== "desktop") return
  const remote = ctx.use(Ssh)
  const layout = ctx.use(Layout)
  const dialog = ctx.use(Dialogs)
  const Row = lazy(() => import("./row"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  ctx.cleanup(onIdle(() => void Row.preload()))
  const state = () => remote()?.state()
  const ssh = createSshController({
    items: () => state()?.servers ?? [],
    api: remote,
    // Resolves once main publishes the revision; disabling the extension resolves it early.
    refresh: (revision) =>
      new Promise<void>((resolve) =>
        createRoot((dispose) => {
          const done = () => {
            dispose()
            resolve()
          }
          ctx.signal.addEventListener("abort", done, { once: true })
          createEffect(() => {
            if ((state()?.revision ?? 0) < revision) return
            ctx.signal.removeEventListener("abort", done)
            done()
          })
        }),
      ),
    error: () => showToast({ variant: "error", title: ctx.t("common.requestFailed") }),
  })
  // A visit to the routed page: a new token each time another tab or page is routed, whether or not a cover shows.
  const visit = createMemo(() => ({ path: app.path() }))
  const offer: SshOffer = { visit: undefined }
  const styled = { added: false }
  const byKey = (key: string) => (key.startsWith("ssh:") ? ssh.item(key.slice(4)) : undefined)

  const show = (render: (module: Awaited<ReturnType<typeof loadDialog>>) => JSX.Element) =>
    void loadDialog().then((module) => {
      if (ctx.signal.aborted) return
      if (!styled.added) ctx.add(Style, module.css)
      styled.added = true
      dialog.push(() => render(module))
    })
  const add = (openProject: boolean) =>
    show((module) => (
      <module.DialogSsh
        ssh={ssh}
        onOpenProject={
          openProject
            ? (id) => {
                const item = ssh.item(id)
                if (!item) return
                layout.project(`ssh:${id}`, ctx.t("project", { host: sshName(item.config) }))
              }
            : undefined
        }
      />
    ))

  const entry = (item: SshItem): ServerEntry => {
    const id = item.config.id
    const config = (): SshConfig => ssh.item(id)?.config ?? item.config
    return {
      id,
      name: sshName(item.config),
      label: ctx.t("label"),
      state: sshServerState(item),
      http: item.http,
      reconnect: (signal) => ssh.resolve(id, signal),
      connect: () => new Promise((resolve) => ssh.connect(config(), { onConnected: resolve })),
      remove: () => ssh.forget(id),
      row: (row) => (
        <Suspense>
          <Row row={row} id={id} ssh={ssh} />
        </Suspense>
      ),
      cover: () => <SshCover id={id} visit={visit()} ssh={ssh} offer={offer} />,
    }
  }

  ctx.add(Server, () => {
    const current = state()
    return {
      ready: current !== undefined,
      order: 2,
      entries: (current?.servers ?? []).filter((item) => item.saved).map(entry),
    }
  })

  ctx.add(Menu, (): Menu => ({ menu: "server.add", id: "add", title: ctx.t("add"), order: 1, run: () => add(false) }))
  ctx.add(
    Command,
    (): Command => ({
      id: "add",
      title: ctx.t("add"),
      group: ctx.t("command.category.server"),
      run: () => add(true),
    }),
  )
  ctx.add(
    Menu,
    (): Menu => ({
      menu: "server.row",
      id: "connect",
      title: ctx.t("connect"),
      order: 1,
      when: (key) => {
        const stage = byKey(key)?.stage
        return stage !== undefined && stage !== "ready" && stage !== "authentication"
      },
      enabled: (key) => !ssh.pending(key.slice(4)),
      run: (key) => {
        const item = byKey(key)
        if (item) ssh.connect(item.config)
      },
    }),
  )
  ctx.add(
    Menu,
    (): Menu => ({
      menu: "server.row",
      id: "authenticate",
      title: ctx.t("authenticate"),
      order: 1,
      when: (key) => byKey(key)?.stage === "authentication",
      enabled: (key) => !ssh.pending(key.slice(4)),
      run: (key) => {
        const item = byKey(key)
        if (item) ssh.connect(item.config)
      },
    }),
  )

  // Reconnect saved servers in the background once per window. Mark active
  // connections too, so a later manual disconnect is respected.
  const restored = new Set<string>()
  createEffect(() => {
    for (const item of state()?.servers ?? []) {
      if (!item.saved || restored.has(item.config.id)) continue
      restored.add(item.config.id)
      if (item.stage === "disconnected") void ssh.restore(item.config)
    }
  })

  // Challenges of an attempt started without its dialog open one of their own.
  createEffect(() => {
    const item = ssh.dialog.next()
    if (!item || dialog.active()) return
    ssh.dialog.opened(item.config.id)
    const config = item.config
    untrack(() => show((module) => <module.DialogSsh ssh={ssh} config={config} promptOnly />))
  })
}

export default setup
