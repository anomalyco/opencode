import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerDialogForm } from "./dialog"
import {
  selectServerConnectView,
  startServerConnect,
  transitionServerConnect,
  type ServerCameraSupport,
  type ServerConnectEvent,
  type ServerConnectTarget,
} from "./machine"
import { PairingScannerView } from "./scanner-view"
import type { ScannerView } from "./scanner-machine"

export const address = "https://build.example.test"

export const link = `${address}/auth/connect/example`

type Preset = {
  camera?: ServerCameraSupport
  target?: Extract<ServerConnectTarget, { kind: "edit" }>
  events?: ServerConnectEvent[]
  scanner?: ScannerView
  redeemError?: "expired" | "unreachable"
  closed?: boolean
}

export function serverStory(preset: Preset = {}) {
  return { render: () => <Story preset={preset} /> }
}

function Story(props: { preset: Preset }) {
  const dialog = useDialog()

  const [saved, setSaved] = createSignal("")

  const open = () => {
    setSaved("")
    void dialog.show(() => <Preview preset={props.preset} onSave={setSaved} />)
  }

  onMount(() => {
    if (!props.preset.closed) open()
  })

  return (
    <div class="flex flex-col items-start gap-3">
      <Button variant="neutral" onClick={open}>
        Open {props.preset.target?.kind ?? "add"} server dialog
      </Button>
      <Show when={saved()}>{(name) => <p role="status">Saved {name()} in this preview.</p>}</Show>
    </div>
  )
}

function Preview(props: { preset: Preset; onSave: (name: string) => void }) {
  const dialog = useDialog()

  const language = useLanguage()

  const preset = props.preset

  const initial = startServerConnect(preset.target ?? { kind: "add" }, preset.camera ?? "probe").state

  const [state, setState] = createSignal(
    (preset.events ?? []).reduce((state, event) => transitionServerConnect(state, event).state, initial),
  )

  if (preset.redeemError) {
    const message = language.t(`server.connect.link.${preset.redeemError}`, { url: address })
    setState(
      transitionServerConnect(state(), {
        type: "submit.failed",
        attempt: state().attempt,
        error: { type: "redeem", message },
      }).state,
    )
  }

  const view = createMemo(() =>
    selectServerConnectView(state(), { surface: "dialog", pageHref: "https://lab.example.test", t: language.t }),
  )

  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ServerConnectEvent) => {
    const step = transitionServerConnect(untrack(state), event)
    setState(step.state)
    step.effects.forEach((effect) => {
      if (effect.type === "camera.probe") dispatch({ type: "camera.settled", attempt: effect.attempt, available: true })

      if (effect.type === "close") {
        if (effect.saved) props.onSave(effect.saved.displayName ?? effect.saved.http.url)
        dialog.close()
      }

      if (effect.type !== "connect.http" && effect.type !== "connect.link") return
      const http = effect.type === "connect.http" ? effect.http : { url: effect.fallbackUrl }

      timer = setTimeout(() => {
        if (dialog.closing) return
        dispatch({ type: "submit.succeeded", attempt: effect.attempt, http })
      }, 700)
    })
  }

  onCleanup(() => clearTimeout(timer))

  return (
    <ServerDialogForm mode={preset.target?.kind ?? "add"} form={{ view, dispatch }}>
      <PairingScannerView
        view={preset.scanner ?? { overlay: undefined, error: undefined }}
        onCancel={() => dispatch({ type: "scan.cancelled" })}
      >
        <video muted playsinline aria-label={language.t("server.connect.camera")} />
      </PairingScannerView>
      <Show when={!preset.scanner?.overlay && preset.scanner?.error?.type !== "camera"}>
        <Button variant="neutral" onClick={() => dispatch({ type: "scan.completed", link })}>
          Read fixture QR code
        </Button>
      </Show>
    </ServerDialogForm>
  )
}
