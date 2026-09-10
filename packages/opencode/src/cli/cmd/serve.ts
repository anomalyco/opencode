import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { Server as NetServer } from "net"
import * as Net from "net"
import {
  resolveAddresses,
  buildPairingPayload,
  generateEphemeralPassword,
  renderQrPairing,
  type PairingInfo,
} from "../qr"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("qr", {
      type: "boolean" as const,
      describe: "emit a scannable QR pairing payload for the OpenCode mobile/desktop app",
      default: false,
    }),
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))

    // --- QR pairing emit (Antigravity-style: scan → connect) ---
    if (args.qr) {
      let password = Flag.OPENCODE_SERVER_PASSWORD
      let ephemeral = false
      if (!password) {
        password = generateEphemeralPassword()
        ephemeral = true
      }
      const net = yield* Effect.promise(() =>
        import("net")
      )
      const probePort = yield* Effect.promise(
        () =>
          new Promise<number>((resolve) => {
            const s = net.createServer()
            s.listen(0, () => {
              const p = s.address()
              s.close(() => resolve(typeof p === "object" && p ? p.port : 0))
            })
          })
      )
      const addresses = resolveAddresses()
      const payload: PairingInfo = buildPairingPayload(addresses, probePort, password)
      console.log("\n" + renderQrPairing(payload) + "\n")
      if (ephemeral) {
        console.log(
          `  Generated ephemeral password: ${password}\n` +
            "  (set OPENCODE_SERVER_PASSWORD to make this permanent)\n"
        )
      }
      console.log("  Waiting for mobile app to scan the QR...\n")
    }

    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
