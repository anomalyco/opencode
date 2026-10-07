import { PairingHost, pairingClient, pairingServer } from "../../../storybook/.storybook/mocks/gui-extensions/pairing"
import PairingPage from "./page"

const story = (urls: readonly string[], links?: { custom?: string; selected?: string }, main = true) => ({
  render: () => {
    const server = pairingServer(urls)
    const client = pairingClient()

    return (
      <PairingHost links={links}>
        <PairingPage
          server={() => server}
          pairing={() =>
            main ? { status: "active", value: client, generation: 1 } : { status: "inactive", reason: "disabled" }
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
        component: "Settings → Pairing on desktop: the addresses a pairing link can use, and its QR code.",
      },
    },
  },
}

/** The server listens on the local network and on a VPN address. */
export const NetworkAddresses = story([
  "http://127.0.0.1:49374",
  "http://192.168.10.248:49374",
  "http://100.87.251.43:49374",
])

/** A saved custom address, such as a VPN, tunnel or reverse proxy URL, is offered first. */
export const CustomAddress = story(["http://127.0.0.1:49374", "http://192.168.10.248:49374"], {
  custom: "https://opencode.example.com",
})

/** The default service only listens on this computer, so the page explains how to let other devices in. */
export const OnlyThisComputer = story(["http://127.0.0.1:49374"])

/** Pairing's main side is not running: the link still works from the server, and only the display setting is gone. */
export const WithoutMainProcess = story(["http://127.0.0.1:49374", "http://192.168.10.248:49374"], undefined, false)
