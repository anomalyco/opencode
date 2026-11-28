import { address, field, link, password, serverLab, submit } from "./connect.fixture"
import type { ServerConnectTarget } from "./machine"

const edit = {
  kind: "edit",
  original: { url: address, displayName: "Build cluster", password: undefined, unauthorized: false },
} satisfies ServerConnectTarget

export default {
  title: "App/Dialogs/Add Server",
  id: "app-dialog-add-server",
}

export const PairingLink = serverLab()

export const Password = serverLab({ events: [password] })

export const ReadyToPair = serverLab({ events: [field("link", link), field("name", "Build cluster")] })

export const InvalidLink = serverLab({ events: [field("link", "incomplete"), submit] })

export const LegacyLink = serverLab({ events: [field("link", `${address}/connect#example`), submit] })

export const ExpiredLink = serverLab({ events: [field("link", link), submit], exchange: "expired" })

export const UnreachableLink = serverLab({ events: [field("link", link), submit], exchange: "unreachable" })

export const InvalidAddress = serverLab({ events: [password, field("url", "file:///example"), submit] })

export const ConnectionFailed = serverLab({ events: [password, field("url", address), submit], check: "unreachable" })

export const MixedContent = serverLab({
  events: [password, field("url", "http://build.example.test"), submit],
  check: "unreachable",
})

export const Checking = serverLab({ events: [field("link", link), submit], check: "pending" })

export const CameraProbing = serverLab({ camera: "probing" })

export const CameraUnavailable = serverLab({ camera: "unavailable" })

export const CameraInsecure = serverLab({ camera: "insecure" })

export const NativePairing = serverLab({ camera: "none" })

export const Scanning = serverLab({ scanner: "ready" })

export const OpeningCamera = serverLab({ scanner: "opening" })

export const RedeemingScan = serverLab({ scanner: "redeeming" })

export const CameraError = serverLab({ scanner: "denied" })

export const InvalidQrCode = serverLab({ scanner: "invalid" })

export const DecodeFailed = serverLab({ scanner: "decode" })

export const ExpiredQrCode = serverLab({ scanner: "expired" })

export const ScanTimedOut = serverLab({ scanner: "timeout" })

export const EditPassword = serverLab({ target: edit })

export const SignedOut = serverLab({ target: { ...edit, original: { ...edit.original, unauthorized: true } } })

export const Closed = serverLab({ closed: true })
