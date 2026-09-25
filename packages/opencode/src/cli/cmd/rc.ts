import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { networkInterfaces } from "os"

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []
  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue
    for (const netInfo of net) {
      if (netInfo.internal || netInfo.family !== "IPv4") continue
      if (netInfo.address.startsWith("172.")) continue
      results.push(netInfo.address)
    }
  }
  return results
}

export const RcCommand = effectCmd({
  command: "rc",
  describe: "start remote control server with QR (like Claude Code)",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("qr-only", {
      describe: "only print QR url and exit",
      type: "boolean",
      default: false,
    }),
  instance: false,
  handler: Effect.fn("Cli.rc")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  OPENCODE_SERVER_PASSWORD not set; RC is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    const displayUrl = server.url.toString()
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(displayUrl)}`
    const attachCmd = `opencode attach ${displayUrl}`

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  RC web:          ", UI.Style.TEXT_NORMAL, displayUrl)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  RC attach:       ", UI.Style.TEXT_NORMAL, attachCmd)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  RC QR:           ", UI.Style.TEXT_NORMAL, qrUrl)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  RC page:         ", UI.Style.TEXT_NORMAL, `${displayUrl}rc`)
    if (opts.hostname === "0.0.0.0") {
      const ips = getNetworkIPs()
      for (const ip of ips) {
        const lanUrl = `http://${ip}:${server.port}`
        UI.println(UI.Style.TEXT_INFO_BOLD + "  LAN:             ", UI.Style.TEXT_NORMAL, lanUrl)
      }
      if (opts.mdns) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:            ",
          UI.Style.TEXT_NORMAL,
          `${opts.mdnsDomain}:${server.port}`,
        )
      }
    }
    UI.empty()
    UI.println(UI.Style.TEXT_DIM + "  Scan QR on phone or open RC web. Add to Home Screen for app-like RC.")

    if ((args as any)["qr-only"]) return

    yield* Effect.never
  }),
})
