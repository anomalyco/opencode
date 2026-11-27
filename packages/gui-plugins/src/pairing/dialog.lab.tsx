import { createSignal, onMount } from "solid-js"
import { PairingHost, pairingRemote } from "../../../stories/mocks/gui-plugins/pairing"
import PairingPage from "./page"

type Preset = Parameters<typeof pairingRemote>[0] & { holdSetup?: boolean }

function PairingDialogStory(props: { preset: Preset; localServer: boolean }) {
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

const story = (preset: Preset, args?: { localServer: boolean }) => ({
  args,
  render: (props: { localServer: boolean }) => <PairingDialogStory preset={preset} localServer={props.localServer} />,
})

export default {
  title: "App/Dialogs/Pair Device",
  id: "app-dialog-pair-device",
  args: { localServer: true },
}

export const Ready = story({ enabled: true })

export const SettingUp = story({ enabled: false, holdSetup: true })

/** Turns on remote access and waits for the tunnel to connect before the first code arrives. */
export const FirstPairing = story({ enabled: false, response: "Tunnel connects slowly" })

/** Try again turns remote access on after the first attempt fails. */
export const Failed = story({ enabled: false, response: "Remote change fails" })

export const Unavailable = story({ enabled: true }, { localServer: false })

/** The first request shows the code loader. Refresh code keeps the previous QR visible until its replacement arrives. */
export const GeneratingCode = story({ enabled: true, response: "Code arrives slowly" })

export const CodeRequestFailed = story({ enabled: true, response: "Code request fails" })

/** Refresh code fails once, then the same action fetches a replacement from the error state. */
export const RefreshFailsOnce = story({ enabled: true, response: "Code refresh fails" })

export const ExpiringCode = story({ enabled: true, expiresIn: 5 })

export const CopyFailsOnce = story({ enabled: true, response: "Copy fails" })
