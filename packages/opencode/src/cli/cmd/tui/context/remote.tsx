import type { RemoteAccess } from "@/server/remote-access"
import { createSimpleContext } from "./helper"

export type RemotePairingResult = {
  directory: string
  sessionID: string
  expiresAt: number
  generatedPassword?: string
  accessURLs: string[]
  pairingURLs: string[]
  qr: string
  mode: RemoteAccess.Mode
  bind: string
}

export type RemoteContextValue = {
  available: boolean
  pair: (input: { sessionID: string; ttlSeconds?: number; mode?: RemoteAccess.Mode }) => Promise<RemotePairingResult>
  stop: () => Promise<void>
}

export const { use: useRemote, provider: RemoteProvider } = createSimpleContext<
  RemoteContextValue,
  {
    remote?: RemoteContextValue
  }
>({
  name: "Remote",
  init: (props) =>
    props.remote ?? {
      available: false,
      async pair() {
        throw new Error("Mobile remote pairing is not available in this session")
      },
      async stop() {},
    },
})
