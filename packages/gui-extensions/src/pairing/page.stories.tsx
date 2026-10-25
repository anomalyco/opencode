import { PairingHost, pairingRemote } from "../../../storybook/.storybook/mocks/gui-extensions/pairing"
import PairingPage from "./page"

const story = (remote: { enabled: boolean; fails?: boolean }, main = true) => ({
  render: () => {
    const mock = pairingRemote(remote)

    return (
      <PairingHost>
        <PairingPage
          server={() => mock.server}
          pairing={() =>
            main ? { status: "active", value: mock.client, generation: 1 } : { status: "inactive", reason: "disabled" }
          }
        />
      </PairingHost>
    )
  },
})

export default {
  title: "Extensions/Pairing",
  id: "extensions-pairing",
  parameters: {
    docs: {
      description: {
        component: "Settings → Pairing on desktop: pair a device from anywhere through remote access, and its QR code.",
      },
    },
  },
}

/** Remote access is on, so Pair device shows the QR code at once. */
export const RemoteOn = story({ enabled: true })

/** The first pairing turns remote access on, then shows the QR code once the tunnel connects. */
export const FirstPairing = story({ enabled: false })

/** Remote access cannot be turned on, so the dialog offers to try again. */
export const SetupFails = story({ enabled: false, fails: true })

/** Pairing's main side is not running, so remote access cannot be turned on and pairing is unavailable. */
export const WithoutMainProcess = story({ enabled: false }, false)
