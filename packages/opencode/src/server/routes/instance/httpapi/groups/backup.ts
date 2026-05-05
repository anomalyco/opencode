import { Backup } from "@/backup"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const SessionPayload = Schema.Struct({
  sessionID: SessionID,
})

export const ImportPayload = Schema.Struct({
  payload: Backup.Payload,
})

export const SessionResponse = Schema.Struct({
  sessionID: SessionID,
})

export const BackupPaths = {
  list: "/backup/list",
  export: "/backup/export",
  import: "/backup/import",
} as const

export const BackupApi = HttpApi.make("backup")
  .add(
    HttpApiGroup.make("backup")
      .add(
        HttpApiEndpoint.post("list", BackupPaths.list, {
          success: described(Schema.Array(Session.Info), "Sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "backup.list",
            summary: "List backup sessions",
            description: "List all local sessions available for backup export.",
          }),
        ),
        HttpApiEndpoint.post("export", BackupPaths.export, {
          payload: SessionPayload,
          success: described(Backup.Payload, "Backup payload"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "backup.export",
            summary: "Export session backup",
            description: "Return the full JSON backup payload for a single session.",
          }),
        ),
        HttpApiEndpoint.post("import", BackupPaths.import, {
          payload: ImportPayload,
          success: described(SessionResponse, "Imported session"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "backup.import",
            summary: "Import session backup",
            description: "Restore a single session from a JSON backup payload.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "backup", description: "Experimental HttpApi backup routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
