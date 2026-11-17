import { address, field, link, password, screenStory, submit } from "./connect.fixture"

export default {
  title: "App/Servers/Connect to Server",
  id: "app-connect-to-server",
  parameters: { layout: "fullscreen" },
}

export const PairingLink = screenStory()

export const ReadyToPair = screenStory({ events: [field("link", link)] })

// A signed-out server keeps its original address when the new pairing token works there.
export const PairAgain = screenStory({ url: "https://saved.example.test", events: [field("link", link)] })

export const Password = screenStory({ events: [password] })

export const BareServerAddress = screenStory({ events: [field("link", address), submit] })

export const InvalidLink = screenStory({ events: [field("link", "incomplete"), submit] })

export const LegacyLink = screenStory({ events: [field("link", `${address}/connect#example`), submit] })

export const ExpiredLink = screenStory({ events: [field("link", link), submit], exchange: "expired" })

export const UnreachableLink = screenStory({ events: [field("link", link), submit], exchange: "unreachable" })

export const MixedContent = screenStory({
  events: [field("link", "http://build.example.test/auth/connect/example"), submit],
  exchange: "unreachable",
})

export const Checking = screenStory({ events: [field("link", link), submit], check: "pending" })

export const ConnectionFailed = screenStory({ events: [field("link", link), submit], check: "unreachable" })

export const InvalidAddress = screenStory({ events: [password, field("url", "file:///example"), submit] })

export const CameraProbing = screenStory({ camera: "probing" })

export const CameraUnavailable = screenStory({ camera: "unavailable" })

export const CameraInsecure = screenStory({ camera: "insecure" })

export const NativePairing = screenStory({ camera: "none" })

export const OpeningCamera = screenStory({ scanner: "opening" })

export const Scanning = screenStory({ scanner: "ready" })

export const RetryAfterScan = screenStory({ scanner: "ready", check: "unreachable" })

export const RedeemingScan = screenStory({ scanner: "redeeming" })

export const CameraError = screenStory({ scanner: "denied" })

export const InvalidQrCode = screenStory({ scanner: "invalid" })

export const ExpiredQrCode = screenStory({ scanner: "expired" })

export const DecodeFailed = screenStory({ scanner: "decode" })

export const ScanTimedOut = screenStory({ scanner: "timeout" })
