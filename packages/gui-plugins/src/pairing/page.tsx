import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { createMemo, createSignal, Match, onCleanup, Show, Switch, untrack, type Accessor } from "solid-js"
import { renderSVG } from "@opencode/util/qr"
import { createKeyed, usePlugin, type DialogHandle, type Live, type IpcClient } from "@opencode/plugin/gui"
import type { Pairing } from "./contract"
import { copyEffectFailed, createCopyState, transitionCopy, viewCopy, type CopyEffect } from "./copy-machine"
import { createDispatch } from "./dispatch"
import type definition from "./index"
import {
  createPairingState,
  dialogUrl,
  pairingEffectFailed,
  remainingSeconds,
  transitionPairing,
  viewDialog,
  viewPairingPage,
  type DialogState,
  type MainStatus,
  type PairingEffect,
  type PairingEvent,
} from "./machine"
import { remoteAddress } from "./remote"

type Client = IpcClient<typeof Pairing.spec>

/** The open "Pair a device" dialog, closed with the page. */
type OpenedDialog = { dialog?: DialogHandle }

/** The pending clipboard timeout, or the return from "Copied" to the copy label. */
type CopyTimer = { id?: ReturnType<typeof setTimeout> }

/**
 * The parts of the local server's `ServerRef` the page uses. The renderer passes the live ref, so `client` is read
 * on every call and follows a restarted server.
 */
export type PairingServer = {
  readonly client: {
    readonly server: {
      info(options: { signal: AbortSignal }): Promise<{ readonly urls: readonly string[] }>
      pair(options: { signal: AbortSignal }): Promise<{ readonly code: string; readonly expires_in: number }>
    }
  }
}

export default function PairingPage(props: {
  server: Accessor<PairingServer | undefined>
  pairing: Accessor<Live<Client>>
}) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  // The plugin's dialogs close with it, so disabling pairing also stops the dialog's code polling.
  const dialogs = ctx.dialogs

  // Remote access and the display setting need pairing's main side; codes come from the server, so they never wait.
  const main = () => {
    const live = props.pairing()

    return live.status === "active" ? live : undefined
  }

  const [pairingState, setPairingState] = createSignal(createPairingState())
  const pageView = createMemo(() => viewPairingPage(pairingState()))
  // Each attempt's request and its timeout or retry delay.
  const requests = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  const opened: OpenedDialog = {}

  const dispatch = createDispatch({
    read: () => untrack(pairingState),
    write: setPairingState,
    transition: transitionPairing,
    run: (effect: PairingEffect) => run(effect),
    failed: pairingEffectFailed,
  })

  // Starts an attempt whose timer ends it with `expire`; returns the signal for its request.
  const start = (attempt: number, ms: number, expire: () => void) => {
    const controller = new AbortController()

    requests.set(attempt, { controller, timer: setTimeout(expire, ms) })

    return AbortSignal.any([ctx.signal, controller.signal])
  }

  // Reads or changes the display sleep setting through the generation that asked for it. `screenActive` has no input,
  // so its options are its only argument. The attempt's signal ends either call at its timeout, or when the page or
  // that generation goes away.
  const runScreen = (effect: Extract<PairingEffect, { type: "read-screen" | "set-screen" }>) => {
    const attempt = effect.attempt

    const fail = () =>
      dispatch({ type: effect.type === "read-screen" ? "screen.read.failed" : "screen.change.failed", attempt })

    const live = main()

    if (live?.generation !== effect.generation) return fail()

    const signal = start(attempt, effect.timeoutMs, fail)

    if (effect.type === "read-screen")
      return void live.value
        .screenActive({ signal })
        .then((enabled) => dispatch({ type: "screen.read.succeeded", attempt, enabled }), fail)

    void live.value
      .setScreenActive(effect.enabled, { signal })
      .then(() => dispatch({ type: "screen.change.succeeded", attempt }), fail)
  }

  const run = (effect: PairingEffect) => {
    if (effect.type === "abort") {
      const request = requests.get(effect.attempt)

      requests.delete(effect.attempt)
      clearTimeout(request?.timer)
      request?.controller.abort()

      return
    }

    if (effect.type === "open-dialog") {
      opened.dialog = dialogs.open(() => <DialogPairing dialog={() => pairingState().dialog} onEvent={dispatch} />)

      return
    }

    if (effect.type === "close-dialog") return opened.dialog?.close()

    if (effect.type === "read-screen" || effect.type === "set-screen") return runScreen(effect)

    if (effect.type === "read-remote" || effect.type === "set-remote") {
      const attempt = effect.attempt
      const fail = () => dispatch({ type: effect.type === "read-remote" ? "read.failed" : "change.failed", attempt })
      const live = main()

      if (live?.generation !== effect.generation) return fail()

      const signal = start(attempt, effect.timeoutMs, fail)

      if (effect.type === "read-remote")
        return void live.value
          .remote({ signal })
          .then((enabled) => dispatch({ type: "read.succeeded", attempt, enabled }), fail)

      // Main restarts the background service on every change, so a setting that already matches is left alone unless
      // `restart` asks for it, as a tunnel that never connected needs.
      return void (async () => {
        if (effect.restart || (await live.value.remote({ signal })) !== effect.enabled)
          await live.value.setRemote(effect.enabled, { signal })
      })().then(() => dispatch({ type: "change.succeeded", attempt }), fail)
    }

    if (effect.type === "wait") {
      const attempt = effect.attempt

      const phase = effect.for

      return void start(attempt, effect.delayMs, () => dispatch({ type: "wait.ended", for: phase, attempt }))
    }

    const attempt = effect.attempt
    const server = props.server()

    if (effect.type === "poll-tunnel") {
      const missing = () => dispatch({ type: "tunnel.missing", attempt })

      if (!server) return missing()

      return void server.client.server.info({ signal: start(attempt, effect.timeoutMs, missing) }).then((info) => {
        const tunnel = remoteAddress(info.urls)

        dispatch(tunnel ? { type: "tunnel.found", attempt, tunnel } : { type: "tunnel.missing", attempt })
      }, missing)
    }

    const failed = () => dispatch({ type: "code.failed", attempt })

    if (!server) return failed()

    void server.client.server.pair({ signal: start(attempt, effect.timeoutMs, failed) }).then(
      (pairing) =>
        dispatch({
          type: "code.loaded",
          attempt,
          code: pairing.code,
          expiresIn: pairing.expires_in,
          now: Date.now(),
        }),
      failed,
    )
  }

  // Follows pairing's main side through its generations, and its pending and inactive states, which a `Live`
  // source to `createKeyed` would not tell apart.
  createKeyed(
    (): MainStatus => {
      const live = props.pairing()

      return live.status === "active" ? { status: "active", generation: live.generation } : { status: live.status }
    },
    (status) => dispatch({ type: "main.changed", main: status }),
    {
      equals: (previous, next) =>
        previous.status === next.status &&
        (previous.status !== "active" || next.status !== "active" || previous.generation === next.generation),
    },
  )
  createKeyed(
    () => ({ available: !!props.server() }),
    (server) => dispatch({ type: "server.changed", available: server.available }),
    { equals: (previous, next) => previous.available === next.available },
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <ui.SettingsLayout title={ctx.t("title")} description={ctx.t("description")}>
      <ui.SettingsSection
        footer={
          <>
            <Show when={pageView().remoteError}>
              <p class="text-text-danger-base" role="alert">
                {ctx.t("remote.error")}
              </p>
            </Show>
            <Show when={pageView().screenError}>
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-text-danger-base" role="alert">
                  {ctx.t("screenActive.error")}
                </p>
                <ui.Button size="small" variant="ghost" onClick={() => dispatch({ type: "screen.retry" })}>
                  {ctx.t("retry")}
                </ui.Button>
              </div>
            </Show>
            <Show when={pageView().unavailable}>
              <p class="text-text-danger-base" role="alert">
                {ctx.t("pair.unavailable")}
              </p>
            </Show>
          </>
        }
      >
        <ui.SettingsRow title={ctx.t("pair.title")} description={ctx.t("pair.description")}>
          <ui.Button disabled={pageView().pairDisabled} onClick={() => dispatch({ type: "dialog.opened" })}>
            {ctx.t("pair.open")}
          </ui.Button>
        </ui.SettingsRow>
        <Show when={pageView().mainActive}>
          <ui.SettingsRow
            id="settings-remote-access"
            title={ctx.t("remote.title")}
            description={ctx.t("remote.description")}
          >
            <ui.Switch
              label={ctx.t("remote.title")}
              hideLabel
              checked={pageView().remoteChecked}
              disabled={pageView().remoteDisabled}
              onChange={(enabled) => dispatch({ type: "toggled", enabled })}
            />
          </ui.SettingsRow>
          <ui.SettingsRow
            id="settings-keep-screen-active"
            title={ctx.t("screenActive.title")}
            description={ctx.t("screenActive.description")}
          >
            <ui.Switch
              label={ctx.t("screenActive.title")}
              hideLabel
              checked={pageView().screenChecked}
              disabled={pageView().screenDisabled}
              onChange={(enabled) => dispatch({ type: "screen.toggled", enabled })}
            />
          </ui.SettingsRow>
        </Show>
      </ui.SettingsSection>
    </ui.SettingsLayout>
  )
}

function DialogPairing(props: {
  dialog: Accessor<DialogState>
  onEvent: (event: Extract<PairingEvent, { type: "code.refresh" | "retry" | "tick" | "dialog.closed" }>) => void
}) {
  const ctx = usePlugin()
  const system = ctx.system
  const view = createMemo(() => viewDialog(props.dialog()))
  const url = createMemo(() => dialogUrl(props.dialog()))

  // The countdown is the only clock on the page. A window that slept or was hidden ticks again as it comes back, so it
  // replaces a code that expired meanwhile at once.
  const [now, setNow] = createSignal(Date.now())

  const tick = () => {
    const time = Date.now()

    setNow(time)
    props.onEvent({ type: "tick", now: time })
  }

  const clock = setInterval(tick, 1000)
  document.addEventListener("visibilitychange", tick)
  onCleanup(() => {
    clearInterval(clock)
    document.removeEventListener("visibilitychange", tick)
    props.onEvent({ type: "dialog.closed" })
  })

  const [copyState, setCopyState] = createSignal(createCopyState())
  const copyView = createMemo(() => viewCopy(copyState(), url()))
  const copyTimer: CopyTimer = {}

  const dispatchCopy = createDispatch({
    read: () => untrack(copyState),
    write: setCopyState,
    transition: transitionCopy,
    run: (effect: CopyEffect) => runCopy(effect),
    failed: copyEffectFailed,
  })

  const runCopy = (effect: CopyEffect) => {
    if (effect.type === "cancel-timer") return clearTimeout(copyTimer.id)

    const attempt = effect.attempt

    if (effect.type === "schedule-feedback") {
      copyTimer.id = setTimeout(() => dispatchCopy({ type: "feedback.ended", attempt }), effect.delayMs)

      return
    }

    copyTimer.id = setTimeout(() => dispatchCopy({ type: "copy.failed", attempt }), effect.timeoutMs)
    void Promise.try(() => system.copy(effect.url)).then(
      () => dispatchCopy({ type: "copy.succeeded", attempt }),
      () => dispatchCopy({ type: "copy.failed", attempt }),
    )
  }

  onCleanup(() => dispatchCopy({ type: "disposed" }))

  const refresh = (disabled: () => boolean) => (
    <Button
      variant="ghost"
      disabled={disabled()}
      onClick={() => {
        dispatchCopy({ type: "reset" })
        props.onEvent({ type: "code.refresh" })
      }}
    >
      {ctx.t("refresh")}
    </Button>
  )

  const ready = createMemo(() => {
    const current = view()

    return current.kind === "ready" ? current : undefined
  })

  const loading = createMemo(() => {
    const current = view()

    return current.kind === "loading" ? current : undefined
  })

  // The QR code carries the remote address as `opencode pair --remote` prints it, {"code","urls"} JSON, which the
  // app's scanner reads. Keyed by its content, so the countdown and a refresh in flight never draw it again.
  const payload = createMemo(() => ready()?.qr)

  const qr = createMemo(() => {
    const value = payload()

    if (!value) return

    return renderSVG(value, { border: 4, blackColor: "currentColor", whiteColor: "transparent" })
  })

  // The QR code's frame, which also holds the setup progress and its failure, so the dialog keeps its size.
  // It spans the dialog's content width, inset as the header is, and shrinks only to fit a short window.
  const frame = "mx-auto aspect-square w-full max-w-[calc(100dvh-360px)] shrink-0 rounded-[6px]"

  return (
    <Dialog fit containerClass="max-w-[min(400px,calc(100vw-32px))]">
      <DialogHeader>
        <DialogTitleGroup title={ctx.t("pair.title")} description={ctx.t("dialog.description")} />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-4 px-4 pb-4">
        <Switch>
          <Match when={ready()}>
            {(current) => (
              <>
                <div
                  class={`${frame} bg-v2-background-bg-base p-6 text-v2-text-text-base [&>svg]:size-full`}
                  role="img"
                  aria-label={ctx.t("qr")}
                  innerHTML={qr()}
                />
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="me-auto text-12-regular leading-[var(--line-height-compact)] tabular-nums text-v2-text-text-muted"
                    role="timer"
                    aria-live="off"
                  >
                    {ctx.t("expires", { time: countdown(remainingSeconds(props.dialog(), now())) })}
                  </span>
                  {/* The actions wrap together, so a narrow dialog keeps them in one row, right-aligned under the countdown. */}
                  <div class="ms-auto flex items-center gap-2">
                    {refresh(() => current().refreshing)}
                    <Button
                      variant="neutral"
                      icon={copyView().icon}
                      disabled={copyView().disabled}
                      onClick={() => dispatchCopy({ type: "copy.requested", url: current().url })}
                    >
                      {ctx.t(copyView().label)}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Match>
          <Match when={loading()}>
            {(current) => (
              <div
                class={`${frame} flex flex-col items-center justify-center gap-2 bg-v2-background-bg-layer-01 p-6 text-center`}
                role="status"
              >
                <Loader class="size-5 text-v2-icon-icon-muted" />
                <Show when={current().setup}>
                  <span class="text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
                    {ctx.t("setup.title")}
                  </span>
                  <span class="text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted">
                    {ctx.t("setup.description")}
                  </span>
                </Show>
              </div>
            )}
          </Match>
          <Match when={view().kind === "failed"}>
            <div
              class={`${frame} flex flex-col items-center justify-center gap-3 bg-v2-background-bg-layer-01 p-6 text-center`}
            >
              <p class="text-text-danger-base" role="alert">
                {ctx.t("setup.error")}
              </p>
              <Button variant="neutral" onClick={() => props.onEvent({ type: "retry" })}>
                {ctx.t("retry")}
              </Button>
            </div>
          </Match>
          {/* A failed code fetch hides the link, so the way to try again stays next to the error. */}
          <Match when={view().kind === "code-error"}>
            <div class="flex flex-col items-center gap-1">
              <p class="text-text-danger-base" role="alert">
                {ctx.t("error")}
              </p>
              {refresh(() => false)}
            </div>
          </Match>
          <Match when={view().kind === "unavailable"}>
            <div
              class={`${frame} flex flex-col items-center justify-center gap-3 bg-v2-background-bg-layer-01 p-6 text-center`}
            >
              <p class="text-text-danger-base" role="alert">
                {ctx.t("pair.unavailable")}
              </p>
            </div>
          </Match>
        </Switch>
        <Show when={copyView().error}>
          <p class="text-text-danger-base" role="alert">
            {ctx.t("copy.error")}
          </p>
        </Show>
      </DialogBody>
    </Dialog>
  )
}

function countdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
