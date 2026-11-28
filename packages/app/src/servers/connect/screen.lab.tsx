import { address, field, link, password, screenLab, submit } from "./connect.fixture"

export default {
  title: "App/Servers/Connect to Server",
  id: "app-connect-to-server",
  parameters: { layout: "fullscreen" },
}

export const PairingLink = screenLab()

export const ReadyToPair = screenLab({ events: [field("link", link)] })

// A signed-out server keeps its original address when the new pairing token works there.
export const PairAgain = screenLab({ url: "https://saved.example.test", events: [field("link", link)] })

export const Password = screenLab({ events: [password] })

export const BareServerAddress = screenLab({ events: [field("link", address), submit] })

export const InvalidLink = screenLab({ events: [field("link", "incomplete"), submit] })

export const LegacyLink = screenLab({ events: [field("link", `${address}/connect#example`), submit] })

export const ExpiredLink = screenLab({ events: [field("link", link), submit], exchange: "expired" })

export const UnreachableLink = screenLab({ events: [field("link", link), submit], exchange: "unreachable" })

export const MixedContent = screenLab({
  events: [field("link", "http://build.example.test/auth/connect/example"), submit],
  exchange: "unreachable",
})

export const Checking = screenLab({ events: [field("link", link), submit], check: "pending" })

export const ConnectionFailed = screenLab({ events: [field("link", link), submit], check: "unreachable" })

export const InvalidAddress = screenLab({ events: [password, field("url", "file:///example"), submit] })

export const CameraProbing = screenLab({ camera: "probing" })

export const CameraUnavailable = screenLab({ camera: "unavailable" })

export const CameraInsecure = screenLab({ camera: "insecure" })

export const NativePairing = screenLab({ camera: "none" })

export const OpeningCamera = screenLab({ scanner: "opening" })

export const Scanning = screenLab({ scanner: "ready" })

export const RetryAfterScan = screenLab({ scanner: "ready", check: "unreachable" })

export const RedeemingScan = screenLab({ scanner: "redeeming" })

export const CameraError = screenLab({ scanner: "denied" })

export const InvalidQrCode = screenLab({ scanner: "invalid" })

export const ExpiredQrCode = screenLab({ scanner: "expired" })

export const DecodeFailed = screenLab({ scanner: "decode" })

export const ScanTimedOut = screenLab({ scanner: "timeout" })
