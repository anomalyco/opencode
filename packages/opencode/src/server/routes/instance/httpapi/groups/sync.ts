import { NonNegativeInt } from "@daemon-protocol/core/schema"
import { ConfigACEV1 } from "@daemon-protocol/core/v1/config/ace"
import { EventV2 } from "@daemon-protocol/core/event"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/sync"
export const ReplayEvent = Schema.Struct({
  id: EventV2.ID,
  aggregateID: Schema.String,
  seq: NonNegativeInt,
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
})
export const ReplayPayload = Schema.Struct({
  directory: Schema.String,
  events: Schema.NonEmptyArray(ReplayEvent),
})
export const AceAblationPolicyPayload = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  arm: Schema.String.pipe(Schema.optional),
  ace: ConfigACEV1.Info.pipe(Schema.optional),
})
export const AceAblationPayload = Schema.Struct({
  directory: Schema.String,
  events: Schema.NonEmptyArray(ReplayEvent),
  policies: Schema.Array(AceAblationPolicyPayload).pipe(Schema.optional),
})
export const AceAblationSummary = Schema.Struct({
  name: Schema.String,
  arm: Schema.String.pipe(Schema.optional),
  mode: Schema.Literals(["monitor", "fixed-cap", "reject-escalate"]),
  toolCalls: NonNegativeInt,
  spawns: NonNegativeInt,
  wouldBlock: NonNegativeInt,
  observed: NonNegativeInt,
  blocked: NonNegativeInt,
  escalated: NonNegativeInt,
  completedTools: NonNegativeInt,
  failedTools: NonNegativeInt,
  stepEnds: NonNegativeInt,
  byLimit: Schema.Record(Schema.String, NonNegativeInt),
  firstBlockSeq: NonNegativeInt.pipe(Schema.optional),
})
export const AceAblationResponse = Schema.Struct({
  directory: Schema.String,
  sourceSessionID: Schema.String,
  eventCount: NonNegativeInt,
  arms: Schema.Array(AceAblationSummary),
})
export const ReplayResponse = Schema.Struct({
  sessionID: Schema.String,
})
export const SessionPayload = Schema.Struct({
  sessionID: SessionID,
})
export const HistoryPayload = Schema.Record(Schema.String, NonNegativeInt)
export const HistoryEvent = Schema.Struct({
  id: EventV2.ID,
  aggregate_id: Schema.String,
  seq: NonNegativeInt,
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
})

export const SyncPaths = {
  start: `${root}/start`,
  replay: `${root}/replay`,
  aceAblation: `${root}/ace/ablation`,
  steal: `${root}/steal`,
  history: `${root}/history`,
} as const

export const SyncApi = HttpApi.make("sync")
  .add(
    HttpApiGroup.make("sync")
      .add(
        HttpApiEndpoint.post("start", SyncPaths.start, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Workspace sync started"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.start",
            summary: "Start workspace sync",
            description: "Start sync loops for workspaces in the current project that have active sessions.",
          }),
        ),
        HttpApiEndpoint.post("replay", SyncPaths.replay, {
          query: WorkspaceRoutingQuery,
          payload: ReplayPayload,
          success: described(ReplayResponse, "Replayed sync events"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.replay",
            summary: "Replay sync events",
            description: "Validate and replay a complete sync event history.",
          }),
        ),
        HttpApiEndpoint.post("aceAblation", SyncPaths.aceAblation, {
          query: WorkspaceRoutingQuery,
          payload: AceAblationPayload,
          success: described(AceAblationResponse, "ACE ablation summary"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.ace.ablation",
            summary: "Replay ACE policy arms",
            description:
              "Replay a sync event history through ACE policy arms without invoking model providers or tools.",
          }),
        ),
        HttpApiEndpoint.post("steal", SyncPaths.steal, {
          query: WorkspaceRoutingQuery,
          payload: SessionPayload,
          success: described(SessionPayload, "Session stolen into workspace"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.steal",
            summary: "Steal session into workspace",
            description: "Update a session to belong to the current workspace through the sync event system.",
          }),
        ),
        HttpApiEndpoint.post("history", SyncPaths.history, {
          query: WorkspaceRoutingQuery,
          payload: HistoryPayload,
          success: described(Schema.Array(HistoryEvent), "Sync events"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.history.list",
            summary: "List sync events",
            description:
              "List sync events for all aggregates. Keys are aggregate IDs the client already knows about, values are the last known sequence ID. Events with seq > value are returned for those aggregates. Aggregates not listed in the input get their full history.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "sync",
          description: "Experimental HttpApi sync routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "DaemonCode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
