import { address, link, serverStory } from "./dialog.fixture"
import type { ServerConnectEvent, ServerConnectField, ServerConnectTarget } from "./machine"

const field = (field: ServerConnectField, value: string): ServerConnectEvent => ({ type: "field.changed", field, value })

const available = { type: "camera.settled", attempt: 1, available: true } satisfies ServerConnectEvent

const password = { type: "method.changed", method: "password" } satisfies ServerConnectEvent

const submit = { type: "submitted" } satisfies ServerConnectEvent

const scan = [available, { type: "scan.started" }] satisfies ServerConnectEvent[]

const edit = {
  kind: "edit",
  original: { url: address, displayName: "Build cluster", password: undefined, unauthorized: false },
} satisfies ServerConnectTarget

export default {
  title: "App/Dialogs/Add Server",
  id: "app-dialog-add-server",
}

export const PairingLink = serverStory({ events: [available] })

export const Password = serverStory({ events: [available, password] })

export const ReadyToPair = serverStory({ events: [available, field("link", link), field("name", "Build cluster")] })

export const InvalidLink = serverStory({ events: [available, field("link", "incomplete"), submit] })

export const LegacyLink = serverStory({ events: [available, field("link", `${address}/connect#example`), submit] })

export const ExpiredLink = serverStory({ events: [available, field("link", link), submit], redeemError: "expired" })

export const UnreachableLink = serverStory({
  events: [available, field("link", link), submit],
  redeemError: "unreachable",
})

export const InvalidAddress = serverStory({ events: [available, password, field("url", "file:///example"), submit] })

export const ConnectionFailed = serverStory({
  events: [available, password, field("url", address), submit, { type: "submit.timed-out", attempt: 1 }],
})

export const MixedContent = serverStory({
  events: [
    available,
    password,
    field("url", "http://build.example.test"),
    submit,
    { type: "submit.timed-out", attempt: 1 },
  ],
})

export const Checking = serverStory({ events: [available, field("link", link), submit] })

export const CameraProbing = serverStory()

export const CameraUnavailable = serverStory({ camera: "unavailable" })

export const CameraInsecure = serverStory({ camera: "insecure" })

export const NativePairing = serverStory({ camera: "none" })

export const Scanning = serverStory({ events: scan })

export const OpeningCamera = serverStory({ events: scan, scanner: { overlay: "starting", error: undefined } })

export const RedeemingScan = serverStory({ events: scan, scanner: { overlay: "redeeming", error: undefined } })

export const CameraError = serverStory({ events: scan, scanner: { overlay: undefined, error: { type: "camera" } } })

export const InvalidQrCode = serverStory({ events: scan, scanner: { overlay: undefined, error: { type: "invalid" } } })

export const DecodeFailed = serverStory({ events: scan, scanner: { overlay: undefined, error: { type: "decode" } } })

export const ScanTimedOut = serverStory({ events: scan, scanner: { overlay: undefined, error: { type: "timeout" } } })

export const EditPassword = serverStory({ target: edit, events: [available] })

export const SignedOut = serverStory({
  target: { ...edit, original: { ...edit.original, unauthorized: true } },
  events: [available],
})

export const Closed = serverStory({ closed: true, events: [available] })
