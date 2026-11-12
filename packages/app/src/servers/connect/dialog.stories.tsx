import { address, link, serverStory } from "./dialog.fixture"
import type { ServerConnectEvent, ServerConnectField, ServerConnectTarget } from "./machine"

const field = (field: ServerConnectField, value: string) => ({ type: "field.changed", field, value }) as const

const password = { type: "method.changed", method: "password" } satisfies ServerConnectEvent

const submit = { type: "submitted" } satisfies ServerConnectEvent

const edit = {
  kind: "edit",
  original: { url: address, displayName: "Build cluster", password: undefined, unauthorized: false },
} satisfies ServerConnectTarget

export default {
  title: "App/Dialogs/Add Server",
  id: "app-dialog-add-server",
}

export const PairingLink = serverStory()

export const Password = serverStory({ events: [password] })

export const ReadyToPair = serverStory({ events: [field("link", link), field("name", "Build cluster")] })

export const InvalidLink = serverStory({ events: [field("link", "incomplete"), submit] })

export const LegacyLink = serverStory({ events: [field("link", `${address}/connect#example`), submit] })

export const ExpiredLink = serverStory({ events: [field("link", link), submit], exchange: "expired" })

export const UnreachableLink = serverStory({ events: [field("link", link), submit], exchange: "unreachable" })

export const InvalidAddress = serverStory({ events: [password, field("url", "file:///example"), submit] })

export const ConnectionFailed = serverStory({ events: [password, field("url", address), submit], check: "unreachable" })

export const MixedContent = serverStory({
  events: [password, field("url", "http://build.example.test"), submit],
  check: "unreachable",
})

export const Checking = serverStory({ events: [field("link", link), submit], check: "pending" })

export const CameraProbing = serverStory({ camera: "probing" })

export const CameraUnavailable = serverStory({ camera: "unavailable" })

export const CameraInsecure = serverStory({ camera: "insecure" })

export const NativePairing = serverStory({ camera: "none" })

export const Scanning = serverStory({ scanner: "ready" })

export const OpeningCamera = serverStory({ scanner: "opening" })

export const RedeemingScan = serverStory({ scanner: "redeeming" })

export const CameraError = serverStory({ scanner: "denied" })

export const InvalidQrCode = serverStory({ scanner: "invalid" })

export const DecodeFailed = serverStory({ scanner: "decode" })

export const ScanTimedOut = serverStory({ scanner: "timeout" })

export const EditPassword = serverStory({ target: edit })

export const SignedOut = serverStory({ target: { ...edit, original: { ...edit.original, unauthorized: true } } })

export const Closed = serverStory({ closed: true })
