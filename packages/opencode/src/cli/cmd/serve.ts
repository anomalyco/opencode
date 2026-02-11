import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Whisper } from "../../voice/whisper"
import { Coqui } from "../../voice/coqui"
import { Tunnel } from "../../tunnel/tunnel"
import { Instance } from "../../project/instance"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("voice", {
        type: "boolean",
        description: "Enable Voice (Whisper STT and Coqui TTS)",
        default: false,
      })
      .option("tunnel", {
        type: "boolean",
        description: "Enable Cloudflare Tunnel",
        default: false,
      }),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    if (args.voice) {
      console.log("Starting Voice services...")
      Whisper.start().catch((e) => console.error("Failed to start Whisper:", e))
      Coqui.start().catch((e) => console.error("Failed to start Coqui:", e))
    }

    if (args.tunnel) {
      await Tunnel.init()
      const state = await Tunnel.start(server.port || 4096)
      if (state) {
        console.log(`Tunnel URL: ${state.url}`)
      }
    }

    // Wait for a signal to exit
    await new Promise<void>((resolve) => {
      for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
        process.on(signal, () => resolve())
      }
    })

    // Cleanup
    if (args.voice) {
      await Whisper.stop().catch(() => {})
      await Coqui.stop().catch(() => {})
    }
    if (args.tunnel) {
      await Tunnel.stop().catch(() => {})
    }
    await Instance.disposeAll().catch(() => {})
    await server.stop()
  },
})
