import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { createEffect, createSignal, onMount, Show, type ComponentProps } from "solid-js"
import { createServerConnectController } from "./controller"
import { DialogServer } from "./dialog"
import type { ServerCameraSupport, ServerConnectEvent, ServerConnectTarget } from "./machine"
import { PairingScanner } from "./scanner"

export const address = "https://build.example.test"

export const link = `${address}/auth/connect/example`

type CameraScene = "ready" | "opening" | "denied" | "invalid" | "decode" | "redeeming" | "timeout"

type Preset = {
  camera?: ServerCameraSupport | "probing"
  target?: Extract<ServerConnectTarget, { kind: "edit" }>
  events?: Extract<ServerConnectEvent, { type: "field.changed" | "method.changed" | "submitted" }>[]
  scanner?: CameraScene
  exchange?: "expired" | "unreachable"
  check?: "unreachable" | "pending"
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
    void dialog.show(() => (
      <Preview preset={props.preset} onSave={(server) => setSaved(server.displayName ?? server.http.url)} />
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

function Preview(props: { preset: Preset; onSave: ComponentProps<typeof DialogServer>["onSave"] }) {
  const preset = props.preset

  const createForm: NonNullable<ComponentProps<typeof DialogServer>["createForm"]> = (dialog) => {
    const pending = new Promise<never>(() => {})

    let check = preset.check

    let exchange = preset.exchange

    const form = createServerConnectController(
      { ...dialog, target: preset.target ?? { kind: "add" }, removeTabs() {} },
      {
        camera: preset.camera === "probing" ? "probe" : (preset.camera ?? "probe"),
        probeCamera: () => (preset.camera === "probing" ? pending : Promise.resolve(true)),
        pageHref: "https://lab.example.test",
        servers: { list: [], add: (server) => server, remove() {} },
        exchange: async (request) => {
          if (request.code === "pending") return pending

          if (exchange) {
            const type = exchange
            exchange = undefined

            return { type }
          }

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
      },
    )

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

  return (
    <DialogServer
      mode={preset.target?.kind ?? "add"}
      createForm={createForm}
      onSave={props.onSave}
      scanner={(props) => <CameraPreview {...props} scene={preset.scanner ?? "ready"} />}
    />
  )
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
        <Button variant="neutral" onClick={() => detect?.(link)}>
          Read fixture QR code
        </Button>
      </Show>
    </>
  )
}
