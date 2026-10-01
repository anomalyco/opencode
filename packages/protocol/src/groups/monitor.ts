import { Monitor } from "@opencode/schema/monitor"
import { Session } from "@opencode/schema/session"
import { Shell } from "@opencode/schema/shell"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { MonitorNotFoundError, SessionNotFoundError } from "../errors.js"

export const MonitorGroup = HttpApiGroup.make("server.monitor")
  .add(
    HttpApiEndpoint.get("monitor.list", "/api/session/:sessionID/monitor", {
      params: { sessionID: Session.ID },
      success: Schema.Array(Monitor.Info),
      error: SessionNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "monitor.list",
        summary: "List session monitors",
        description:
          "List running and the 25 most recently ended background monitors, including monitors ended by a server restart.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("monitor.output", "/api/session/:sessionID/monitor/:id/output", {
      params: { sessionID: Session.ID, id: Monitor.ID },
      query: Shell.OutputInput,
      success: Shell.Output,
      error: [SessionNotFoundError, MonitorNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "monitor.output",
        summary: "Read monitor output",
        description:
          "Page through retained combined stdout/stderr independently of live shell state. Pages are capped at 64 KiB.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("monitor.stop", "/api/session/:sessionID/monitor/:id/stop", {
      params: { sessionID: Session.ID, id: Monitor.ID },
      success: Monitor.Info,
      error: [SessionNotFoundError, MonitorNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "monitor.stop",
        summary: "Stop session monitor",
        description:
          "Cancel a running monitor while retaining its output. Ended monitors return their terminal status.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "monitor", description: "Session background monitor routes." }))
