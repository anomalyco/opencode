import { createMemo, Show } from "solid-js"
import { PairingHost, pairingRemote, pairingResponses } from "../../../stories/mocks/gui-plugins/pairing"
import type { MainStatus } from "./machine"
import PairingPage from "./page"

type Args = {
  mainProcess: MainStatus["status"]
  localServer: boolean
  remoteAccess: boolean
  keepScreenActive: boolean
  response: (typeof pairingResponses)[number]
  codeLifetimeSeconds: number
}

function PairingStory(args: Args) {
  const fixture = createMemo(() =>
    pairingRemote({
      enabled: args.remoteAccess,
      screenActive: args.keepScreenActive,
      response: args.response,
      expiresIn: args.codeLifetimeSeconds,
    }),
  )

  return (
    <Show when={fixture()} keyed>
      {(mock) => (
        <PairingHost copy={mock.copy}>
          <PairingPage
            server={() => (args.localServer ? mock.server : undefined)}
            pairing={() => {
              if (args.mainProcess === "pending") return { status: "pending" }

              if (args.mainProcess === "inactive") return { status: "inactive", reason: "disabled" }

              return { status: "active", value: mock.client, generation: 1 }
            }}
          />
        </PairingHost>
      )}
    </Show>
  )
}

// Each preset starts a fresh page. Within it, losing main or the server also reaches an already-open dialog.
const story = (args: Partial<Args> = {}) => ({
  args,
  render: (props: Args) => <PairingStory {...props} />,
})

export default {
  title: "App/Plugins/Pairing",
  id: "plugins-pairing",
  args: {
    mainProcess: "active",
    localServer: true,
    remoteAccess: true,
    keepScreenActive: false,
    response: "Normal",
    codeLifetimeSeconds: 300,
  } satisfies Args,
  argTypes: {
    mainProcess: { control: "select", options: ["active", "pending", "inactive"] satisfies Args["mainProcess"][] },
    response: { control: "select", options: pairingResponses },
    codeLifetimeSeconds: { control: { type: "range", min: 5, max: 300, step: 5 } },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Desktop Pairing settings. Change a switch or open Pair device to exercise setup, refresh, copy and retry using local fixtures.",
      },
    },
  },
}

/** Remote access is on, so Pair device shows the QR code at once. */
export const RemoteOn = story()

/** The first pairing turns remote access on, then shows the QR code once the tunnel connects. */
export const FirstPairing = story({ remoteAccess: false })

/** Remote access cannot be turned on, so the dialog offers to try again. */
export const SetupFails = story({ remoteAccess: false, response: "Remote change fails" })

/** Pairing's main side is not running, so remote access cannot be turned on and pairing is unavailable. */
export const WithoutMainProcess = story({ remoteAccess: false, mainProcess: "inactive" })

/** The display sleep setting cannot be read at first; after the retries, Try again reads it and the switch stays enabled. */
export const ScreenSettingFails = story({ response: "Screen read fails" })

export const MainStarting = story({ mainProcess: "pending" })

export const WithoutLocalServer = story({ localServer: false })

export const ScreenAwake = story({ keepScreenActive: true })

export const RemoteSettingFails = story({ remoteAccess: false, response: "Remote read fails" })

export const ScreenChangeFails = story({ keepScreenActive: true, response: "Screen change fails" })

export const TunnelConnecting = story({ response: "Tunnel connects slowly" })

export const CodeRequestFails = story({ response: "Code request fails" })

export const CopyFails = story({ response: "Copy fails" })

export const ExpiringCode = story({ codeLifetimeSeconds: 5 })
