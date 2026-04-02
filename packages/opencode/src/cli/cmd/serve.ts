import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { registerSignals, start as startMemoryTelemetry, setGauges } from "@/telemetry/memory"
import { Instance } from "@/project/instance"
import { SessionPrompt } from "@/session/prompt"
import { Bus } from "@/bus"
import { gauges as trackerGauges } from "@/telemetry/tracker"
import * as fs from "node:fs"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    registerSignals()
    startMemoryTelemetry()
    setGauges(() => {
      const prompt = SessionPrompt.stateSize()
      const bus = Bus.diagnostics()
      const dirs = Instance.directories()
      // Count child processes and zombies on Linux
      let children = 0
      let zombies = 0
      try {
        const kids = fs.readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, "utf8").trim()
        if (kids) {
          const pids = kids.split(" ")
          children = pids.length
          for (const pid of pids) {
            try {
              const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8")
              if (stat.includes(") Z")) zombies++
            } catch {}
          }
        }
      } catch {}
      return {
        instances: dirs.length,
        prompt_sessions: prompt.sessions,
        prompt_pending: prompt.pending,
        bus_active: bus.active,
        children,
        zombies,
        ...trackerGauges(),
      }
    })
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    await new Promise(() => {})
    await server.stop()
  },
})
