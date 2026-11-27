import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createSignal, onMount, Show, type ComponentProps } from "solid-js"
import type { ServerConnection } from "@/runtime/server/registry"
import { createServerConnectController, type ServerConnectControllerOptions } from "./controller"
import { DialogServer } from "./dialog"
import type { ServerCameraSupport, ServerConnectEvent, ServerConnectField, ServerConnectTarget } from "./machine"
import { PairingScanner } from "./scanner"
import { ConnectServerForm } from "./screen"

export const address = "https://build.example.test"

export const link = `${address}/auth/connect/example`

export const field = (field: ServerConnectField, value: string) => ({ type: "field.changed", field, value }) as const

export const password = { type: "method.changed", method: "password" } satisfies ServerConnectEvent

export const submit = { type: "submitted" } satisfies ServerConnectEvent

type CameraScene = "ready" | "opening" | "denied" | "invalid" | "decode" | "expired" | "redeeming" | "timeout"

type Preset = {
  camera?: ServerCameraSupport | "probing"
  events?: Extract<ServerConnectEvent, { type: "field.changed" | "method.changed" | "submitted" }>[]
  scanner?: CameraScene
  exchange?: "expired" | "unreachable"
  check?: "unreachable" | "pending"
}

type DialogPreset = Preset & { target?: Extract<ServerConnectTarget, { kind: "edit" }>; closed?: boolean }

export function serverLab(preset: DialogPreset = {}) {
  return { render: () => <DialogLab preset={preset} /> }
}

function DialogLab(props: { preset: DialogPreset }) {
  const dialog = useDialog()

  const [saved, setSaved] = createSignal("")

  const open = () => {
    setSaved("")
    void dialog.show(() => (
      <DialogServer
        mode={props.preset.target?.kind ?? "add"}
        onSave={(server) => setSaved(server.displayName ?? server.http.url)}
        createForm={(dialog) =>
          createPreviewForm(
            { ...dialog, target: props.preset.target ?? { kind: "add" }, removeTabs() {} },
            props.preset,
          )
        }
        scanner={(scanner) => <CameraPreview {...scanner} scene={props.preset.scanner ?? "ready"} />}
      />
    ))
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

export function screenLab(preset: Preset & { url?: string } = {}) {
  return { render: () => <ScreenLab preset={preset} /> }
}

function ScreenLab(props: { preset: Preset & { url?: string } }) {
  const [connected, setConnected] = createSignal("")

  // On success the app routes away. In the lab show the saved address and let the next run start with a fresh form.
  const Screen = () => {
    const form = createPreviewForm(
      { surface: "screen", target: { kind: "connect", url: props.preset.url } },
      props.preset,
      (server) => setConnected(server.http.url),
    )

    return (
      <ConnectServerForm
        form={form}
        scanner={(scanner) => <CameraPreview {...scanner} scene={props.preset.scanner ?? "ready"} />}
      />
    )
  }

  return (
    <div class="flex h-dvh max-h-full min-h-0 w-full flex-col bg-v2-background-bg-base">
      <Show when={connected()} fallback={<Screen />}>
        {(url) => (
          <div class="m-auto flex flex-col items-center gap-3 p-4">
            <p role="status">Connected to {url()} in this preview.</p>
            <Button variant="neutral" onClick={() => setConnected("")}>
              Pair again
            </Button>
          </div>
        )}
      </Show>
    </div>
  )
}

function createPreviewForm(
  options: ServerConnectControllerOptions,
  preset: Preset,
  onSave?: (server: ServerConnection.Http) => void,
) {
  const pending = new Promise<never>(() => {})

  const spent = new Set(["expired"])

  let check = preset.check

  let exchange = preset.exchange

  const form = createServerConnectController(options, {
    camera: preset.camera === "probing" ? "probe" : (preset.camera ?? "probe"),
    probeCamera: () => (preset.camera === "probing" ? pending : Promise.resolve(true)),
    pageHref: "https://lab.example.test",
    servers: {
      list: [],
      add(server) {
        onSave?.(server)

        return server
      },
      remove() {},
    },
    exchange: async (request) => {
      if (request.code === "pending") return pending

      if (spent.has(request.code)) return { type: "expired" }

      if (exchange) {
        const type = exchange
        exchange = undefined

        if (type === "expired") spent.add(request.code)

        return { type }
      }

      spent.add(request.code)

      return { type: "paired", pairing: { url: request.urls[0], password: "fixture" } }
    },
    check: async () => {
      if (check === "pending") return pending

      if (check === "unreachable") {
        check = undefined

        return { type: "unreachable" }
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 700))

      return { type: "healthy" }
    },
  })

  preset.events?.forEach(form.dispatch)

  if (preset.scanner) {
    let opened = false
    createEffect(() => {
      if (opened || !form.view().canScan) return
      opened = true
      form.dispatch({ type: "scan.started" })
    })
  }

  return form
}

function CameraPreview(props: ComponentProps<typeof PairingScanner> & { scene: CameraScene }) {
  let detect: ((data: string) => void) | undefined

  const camera: NonNullable<ComponentProps<typeof PairingScanner>["camera"]> = (_, read, failed) => {
    detect = read
    let frame: ReturnType<typeof requestAnimationFrame>

    return {
      start: async () => {
        if (props.scene === "denied") throw new Error("Camera permission denied")

        if (props.scene === "opening") return new Promise<void>(() => {})
        frame = requestAnimationFrame(() => {
          if (props.scene === "invalid") read("not a pairing code")

          if (props.scene === "decode") failed()

          if (props.scene === "expired") read(JSON.stringify({ code: "expired", urls: [address] }))

          if (props.scene === "redeeming" || props.scene === "timeout") read(`${address}/auth/connect/pending`)
        })
      },
      stop() {},
      destroy: () => cancelAnimationFrame(frame),
    }
  }

  return (
    <>
      <PairingScanner {...props} camera={camera} />
      <Show when={props.scene !== "opening" && props.scene !== "denied" && props.scene !== "redeeming"}>
        <Button variant="neutral" onClick={() => detect?.(JSON.stringify({ code: "example", urls: [address] }))}>
          Read fixture QR code
        </Button>
      </Show>
    </>
  )
}
