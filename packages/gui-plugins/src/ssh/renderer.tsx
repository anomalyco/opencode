import { showToast } from "@opencode/ui/toast"
import { createRoot, createSignal, lazy, onCleanup, Suspense, untrack, type JSX } from "solid-js"
import { Command, createKeyed, MenuItem, Server, Style, type ServerEntry, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { Ssh, type SshConfig, type SshItem } from "./contract"
import { SshCover } from "./cover"
import type definition from "./index"
import { sshName, sshServerState } from "./name"
import { createSshController } from "./state"
import {
  initialSshAdd,
  SSH_DIALOG_LOAD_TIMEOUT_MS,
  transitionSshAdd,
  type SshAddEffect,
  type SshAddEvent,
} from "./add-machine"

const loadDialog = () => import("./dialog")

type DialogModule = Awaited<ReturnType<typeof loadDialog>>

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  // SSH lives in the desktop main process.
  if (ctx.app.platform !== "desktop") return
  const router = ctx.router
  const ipc = ctx.use(Ssh)
  const layout = ctx.layout
  const dialog = ctx.dialogs
  const Row = lazy(() => import("./row"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void Row.preload()))

  const client = () => {
    const live = ipc()

    return live.status === "active" ? live.value : undefined
  }

  const state = () => client()?.state()

  const ssh = createSshController({
    items: () => state()?.servers ?? [],
    api: client,
    // Resolves once main publishes the revision. Disabling the plugin, the attempt ending, or the main side going away
    // (a restarted main starts its revisions again) resolves it early.
    refresh: (revision, signal) =>
      new Promise<void>((resolve) =>
        createRoot((dispose) => {
          const done = () => {
            ctx.signal.removeEventListener("abort", done)
            signal.removeEventListener("abort", done)
            dispose()
            resolve()
          }

          if (ctx.signal.aborted || signal.aborted) return done()
          ctx.signal.addEventListener("abort", done, { once: true })
          signal.addEventListener("abort", done, { once: true })
          createKeyed(() => ipc().status !== "active" || (state()?.revision ?? 0) >= revision, done)
        }),
      ),
    error: () => showToast({ variant: "error", title: ctx.t("common.requestFailed") }),
    path: () => router.path(),
  })

  const styled = { added: false }
  const byKey = (key: string) => (key.startsWith("ssh:") ? ssh.item(key.slice(4)) : undefined)

  // The dialog chunk under its load budget: one that fails or never loads rejects.
  const boundedDialog = () => {
    const deadline = Promise.withResolvers<never>()
    const timer = setTimeout(() => deadline.reject(new Error()), SSH_DIALOG_LOAD_TIMEOUT_MS)

    return Promise.race([loadDialog(), deadline.promise]).finally(() => clearTimeout(timer))
  }

  const open = (module: DialogModule, render: () => JSX.Element) => {
    if (!styled.added) ctx.add(Style, module.css)
    styled.added = true
    dialog.open(render)
  }

  const [addState, setAddState] = createSignal(initialSshAdd)

  const dispatchAdd = (event: SshAddEvent<DialogModule>) => {
    const next = transitionSshAdd(untrack(addState), event)

    if (next.state !== untrack(addState)) setAddState(next.state)
    next.effects.forEach(runAdd)
  }

  const runAdd = (effect: SshAddEffect<DialogModule>) => {
    if (effect.type === "toast-failed")
      return void showToast({
        variant: "error",
        title: ctx.t("common.requestFailed"),
        description: effect.error || undefined,
      })

    if (effect.type === "load") {
      const attempt = effect.attempt

      return void boundedDialog().then(
        (module) => dispatchAdd({ type: "add.loaded", attempt, module }),
        (cause: unknown) =>
          dispatchAdd({ type: "add.failed", attempt, error: cause instanceof Error ? cause.message : String(cause) }),
      )
    }

    const module = effect.module

    open(module, () => (
      <module.DialogSsh
        ssh={ssh}
        onOpenProject={
          effect.openProject
            ? (id) => {
                const item = ssh.item(id)

                if (!item) return
                layout.project(`ssh:${id}`, ctx.t("project", { host: sshName(item.config) }))
              }
            : undefined
        }
      />
    ))
  }

  onCleanup(() => dispatchAdd({ type: "disposed" }))

  const add = (openProject: boolean) => dispatchAdd({ type: "add.requested", openProject })

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
      remove: () => {
        const live = ipc()

        // Loading or gone, main keeps the server: the removal fails rather than leaving it saved behind the list.
        if (live.status !== "active") return Promise.reject(new Error(ctx.t("error.unavailable")))

        return live.value.forget({ id })
      },
      row: (row) => (
        <Suspense>
          <Row row={row} id={id} ssh={ssh} />
        </Suspense>
      ),
      cover: () => <SshCover id={id} ssh={ssh} />,
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

  ctx.add(
    MenuItem,
    (): MenuItem => ({ menu: "server.add", id: "add", title: ctx.t("add"), order: 1, run: () => add(false) }),
  )
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
    MenuItem,
    (): MenuItem => ({
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
    MenuItem,
    (): MenuItem => ({
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

  // Challenges of an attempt started without its dialog open one of their own. The attempt holds the dialog while its
  // chunk loads, and a chunk that fails to load ends the attempt.
  createKeyed(
    () => (dialog.active() ? undefined : ssh.dialog.next()),
    (target) => {
      const id = target.item.config.id
      const config = target.item.config
      ssh.dialog.loading(id, target.attempt)
      // A chunk that never loads ends the attempt too, so it never waits on a dialog that cannot show.
      void boundedDialog().then(
        (module) => {
          if (ctx.signal.aborted || !ssh.dialog.canOpen(id, target.attempt)) return
          ssh.dialog.opened(id, target.attempt)
          open(module, () => <module.DialogSsh ssh={ssh} config={config} promptOnly />)
        },
        () => ssh.dialog.failed(id, target.attempt),
      )
    },
    {
      equals: (previous, next) => previous.item.config.id === next.item.config.id && previous.attempt === next.attempt,
    },
  )
}

export default setup
