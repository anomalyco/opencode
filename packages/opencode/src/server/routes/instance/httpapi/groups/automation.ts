import { Automation } from "@/automation/automation"
import { AutomationID, AutomationRunID } from "@/automation/schema"
import { Snapshot } from "@/snapshot"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"
import { QueryBoolean } from "./query"

const root = "/automation"

export const AutomationRunsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  automationID: Schema.optional(AutomationID),
  inbox: Schema.optional(QueryBoolean),
  archived: Schema.optional(QueryBoolean),
  limit: Schema.optional(Schema.NumberFromString),
})
export const RunReadPayload = Schema.Struct({
  read: Schema.optional(Schema.Boolean),
})
export const RunArchivePayload = Schema.Struct({
  archived: Schema.optional(Schema.Boolean),
})

export const AutomationPaths = {
  list: root,
  create: root,
  runs: `${root}/runs`,
  run: `${root}/runs/:runID`,
  findings: `${root}/runs/:runID/findings`,
  diff: `${root}/runs/:runID/diff`,
  read: `${root}/runs/:runID/read`,
  archive: `${root}/runs/:runID/archive`,
  cancel: `${root}/runs/:runID/cancel`,
  get: `${root}/:automationID`,
  update: `${root}/:automationID`,
  remove: `${root}/:automationID`,
  duplicate: `${root}/:automationID/duplicate`,
  runNow: `${root}/:automationID/run`,
} as const

export const AutomationApi = HttpApi.make("automation")
  .add(
    HttpApiGroup.make("automation")
      .add(
        HttpApiEndpoint.get("list", AutomationPaths.list, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Automation.Info), "List of automations"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.list",
            summary: "List automations",
            description: "List scheduled automations for the current project.",
          }),
        ),
        HttpApiEndpoint.post("create", AutomationPaths.create, {
          query: WorkspaceRoutingQuery,
          payload: Automation.CreateInput,
          success: described(Automation.Info, "Created automation"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.create",
            summary: "Create automation",
            description: "Create a scheduled automation for the current project.",
          }),
        ),
        HttpApiEndpoint.get("runs", AutomationPaths.runs, {
          query: AutomationRunsQuery,
          success: described(Schema.Array(Automation.RunInfo), "List of automation runs"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.runs",
            summary: "List automation runs",
            description: "List automation runs for the current project.",
          }),
        ),
        HttpApiEndpoint.get("runGet", AutomationPaths.run, {
          params: { runID: AutomationRunID },
          query: WorkspaceRoutingQuery,
          success: described(Automation.RunInfo, "Automation run"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.run.get",
            summary: "Get automation run",
            description: "Get a single automation run.",
          }),
        ),
        HttpApiEndpoint.get("findings", AutomationPaths.findings, {
          params: { runID: AutomationRunID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Automation.Finding), "Automation findings"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.run.findings",
            summary: "List automation run findings",
            description: "List findings for an automation run.",
          }),
        ),
        HttpApiEndpoint.get("diff", AutomationPaths.diff, {
          params: { runID: AutomationRunID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Snapshot.FileDiff), "Automation run diff"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.run.diff",
            summary: "Get automation run diff",
            description: "Get file diffs captured for an automation run session.",
          }),
        ),
        HttpApiEndpoint.post("read", AutomationPaths.read, {
          params: { runID: AutomationRunID },
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, RunReadPayload],
          success: described(Automation.RunInfo, "Automation run"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.run.read",
            summary: "Mark automation run read",
            description: "Mark an automation run read or unread.",
          }),
        ),
        HttpApiEndpoint.post("archive", AutomationPaths.archive, {
          params: { runID: AutomationRunID },
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, RunArchivePayload],
          success: described(Automation.RunInfo, "Automation run"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.run.archive",
            summary: "Archive automation run",
            description: "Archive or unarchive an automation run.",
          }),
        ),
        HttpApiEndpoint.post("cancel", AutomationPaths.cancel, {
          params: { runID: AutomationRunID },
          query: WorkspaceRoutingQuery,
          success: described(Automation.RunInfo, "Automation run"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.run.cancel",
            summary: "Cancel automation run",
            description: "Cancel a queued or running automation run.",
          }),
        ),
        HttpApiEndpoint.get("get", AutomationPaths.get, {
          params: { automationID: AutomationID },
          query: WorkspaceRoutingQuery,
          success: described(Automation.Info, "Automation"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.get",
            summary: "Get automation",
            description: "Get a single automation.",
          }),
        ),
        HttpApiEndpoint.patch("update", AutomationPaths.update, {
          params: { automationID: AutomationID },
          query: WorkspaceRoutingQuery,
          payload: Automation.UpdateInput,
          success: described(Automation.Info, "Updated automation"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.update",
            summary: "Update automation",
            description: "Update a scheduled automation.",
          }),
        ),
        HttpApiEndpoint.delete("remove", AutomationPaths.remove, {
          params: { automationID: AutomationID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Deleted"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.delete",
            summary: "Delete automation",
            description: "Delete a scheduled automation.",
          }),
        ),
        HttpApiEndpoint.post("duplicate", AutomationPaths.duplicate, {
          params: { automationID: AutomationID },
          query: WorkspaceRoutingQuery,
          success: described(Automation.Info, "Duplicated automation"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.duplicate",
            summary: "Duplicate automation",
            description: "Create a disabled copy of an existing scheduled automation.",
          }),
        ),
        HttpApiEndpoint.post("runNow", AutomationPaths.runNow, {
          params: { automationID: AutomationID },
          query: WorkspaceRoutingQuery,
          success: described(Automation.RunInfo, "Queued automation run"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.runNow",
            summary: "Run automation now",
            description: "Queue an automation run immediately.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "automation", description: "Automation routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode automation HttpApi",
      version: "0.0.1",
      description: "HttpApi surface for automation routes.",
    }),
  )
