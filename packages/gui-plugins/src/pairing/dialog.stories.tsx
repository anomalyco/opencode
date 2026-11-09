import { onMount } from "solid-js"
import { PairingHost, pairingRemote } from "../../../stories/mocks/gui-plugins/pairing"
import PairingPage from "./page"

function PairingDialogStory(props: { mode: "ready" | "pending" | "failed" }) {
  const mock = pairingRemote({ enabled: props.mode === "ready" })

  const client = {
    ...mock.client,
    setRemote: (...args: Parameters<typeof mock.client.setRemote>) => {
      if (props.mode === "pending") return new Promise<never>(() => {})

      if (props.mode === "failed") return Promise.reject(new Error("Unable to enable remote access"))

      return mock.client.setRemote(...args)
    },
  }

  let root!: HTMLDivElement

  onMount(() => root.getElementsByTagName("button")[0].click())

  return (
    <PairingHost>
      <div ref={root}>
        <PairingPage server={() => mock.server} pairing={() => ({ status: "active", value: client, generation: 1 })} />
      </div>
    </PairingHost>
  )
}

export default {
  title: "App/Dialogs/Pair Device",
  id: "app-dialog-pair-device",
}

export const Ready = { render: () => <PairingDialogStory mode="ready" /> }

export const SettingUp = { render: () => <PairingDialogStory mode="pending" /> }

export const Failed = { render: () => <PairingDialogStory mode="failed" /> }
