import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { requestPairing } from "../../remote/pairing"
import { runTunnelClient } from "../../remote/tunnel-client"

export const RemoteCommand = cmd({
  command: "remote",
  describe: "expose this opencode workspace to a remote client via a relay",
  builder: (yargs) =>
    yargs
      .option("relay", {
        type: "string",
        describe: "relay URL (defaults to $OPENCODE_RELAY_URL)",
      })
      .option("open", {
        type: "boolean",
        describe: "open the pairing URL in the default browser",
        default: false,
      }),
  handler: async (args) => {
    const relayUrl = (args.relay as string | undefined) ?? Flag.OPENCODE_RELAY_URL
    if (!relayUrl) {
      UI.println(UI.Style.TEXT_DANGER_BOLD + "error: no relay URL configured (set --relay or OPENCODE_RELAY_URL)")
      process.exit(1)
    }

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Relay:           ", UI.Style.TEXT_NORMAL, relayUrl)

    let pair
    try {
      pair = await requestPairing(relayUrl)
    } catch (err) {
      UI.println(UI.Style.TEXT_DANGER_BOLD + "  failed to reach relay: " + (err as Error).message)
      process.exit(1)
    }

    UI.println(UI.Style.TEXT_INFO_BOLD + "  Pairing code:    ", UI.Style.TEXT_HIGHLIGHT_BOLD, pair.code)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Open on device:  ", UI.Style.TEXT_NORMAL, pair.claimUrl)
    UI.println(
      UI.Style.TEXT_DIM +
        "  Code expires in 5 minutes. The tunnel stays open until Ctrl+C; reconnects automatically.",
    )
    UI.empty()

    if (args.open) {
      const { default: open } = await import("open")
      open(pair.claimUrl).catch(() => {})
    }

    const app = Server.Default().app

    const localAuth =
      Flag.OPENCODE_SERVER_PASSWORD != null
        ? {
            username: Flag.OPENCODE_SERVER_USERNAME ?? "opencode",
            password: Flag.OPENCODE_SERVER_PASSWORD,
          }
        : undefined

    const controller = new AbortController()
    const onSignal = () => {
      UI.println(UI.Style.TEXT_DIM + "  shutting down tunnel...")
      controller.abort()
    }
    process.on("SIGINT", onSignal)
    process.on("SIGTERM", onSignal)

    await runTunnelClient({
      relayUrl,
      tunnelToken: pair.tunnelToken,
      app,
      localAuth,
      signal: controller.signal,
      onStatus(status) {
        if (status === "connected") {
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "  tunnel connected")
        } else if (status === "disconnected") {
          UI.println(UI.Style.TEXT_WARNING_BOLD + "  tunnel disconnected — reconnecting...")
        }
      },
    })
  },
})
