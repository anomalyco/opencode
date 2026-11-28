import { createSignal, onMount } from "solid-js"
import { PairingHost, pairingRemote } from "../../../lab/mocks/gui-plugins/pairing"
import PairingPage from "./page"

type Preset = Parameters<typeof pairingRemote>[0] & { holdSetup?: boolean }

function PairingDialogLab(props: { preset: Preset; localServer: boolean }) {
  const mock = pairingRemote(props.preset)

  const client = props.preset.holdSetup
    ? { ...mock.client, setRemote: () => new Promise<never>(() => {}) }
    : mock.client

  const [opened, setOpened] = createSignal(false)

  let root!: HTMLDivElement

  onMount(() => {
    root.getElementsByTagName("button")[0].click()
    // Pair device needs the server to open. Once open, the dialog follows its loss and return.
    setOpened(true)
  })

  return (
    <PairingHost copy={mock.copy}>
      <div ref={root}>
        <PairingPage
          server={() => (!opened() || props.localServer ? mock.server : undefined)}
          pairing={() => ({ status: "active", value: client, generation: 1 })}
        />
      </div>
    </PairingHost>
  )
}

const state = (preset: Preset, args?: { localServer: boolean }) => ({
  args,
  render: (props: { localServer: boolean }) => <PairingDialogLab preset={preset} localServer={props.localServer} />,
})

export default {
  title: "App/Dialogs/Pair Device",
  id: "app-dialog-pair-device",
  args: { localServer: true },
}

export const Ready = state({ enabled: true })

export const SettingUp = state({ enabled: false, holdSetup: true })

/** Turns on remote access and waits for the tunnel to connect before the first code arrives. */
export const FirstPairing = state({ enabled: false, response: "Tunnel connects slowly" })

/** Try again turns remote access on after the first attempt fails. */
export const Failed = state({ enabled: false, response: "Remote change fails" })

export const Unavailable = state({ enabled: true }, { localServer: false })

/** The first request shows the code loader. Refresh code keeps the previous QR visible until its replacement arrives. */
export const GeneratingCode = state({ enabled: true, response: "Code arrives slowly" })

export const CodeRequestFailed = state({ enabled: true, response: "Code request fails" })

/** Refresh code fails once, then the same action fetches a replacement from the error state. */
export const RefreshFailsOnce = state({ enabled: true, response: "Code refresh fails" })

export const ExpiringCode = state({ enabled: true, expiresIn: 5 })

export const CopyFailsOnce = state({ enabled: true, response: "Copy fails" })
