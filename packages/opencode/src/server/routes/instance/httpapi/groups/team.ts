import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const TeamMemberStatus = Schema.Literals(["ready", "busy", "shutdown_requested", "shutdown", "error"])
const TeamExecutionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "cancel_requested",
  "cancelling",
  "cancelled",
  "completing",
  "completed",
  "failed",
  "timed_out",
])

const TeamMember = Schema.Struct({
  name: Schema.String,
  sessionID: Schema.String,
  agent: Schema.String,
  status: TeamMemberStatus,
  execution_status: Schema.optional(TeamExecutionStatus),
  prompt: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  planApproval: Schema.optional(Schema.Literals(["none", "pending", "approved", "rejected"])),
}).annotate({ identifier: "TeamMember" })

const TeamInfo = Schema.Struct({
  name: Schema.String,
  leadSessionID: Schema.String,
  members: Schema.Array(TeamMember),
  created: Schema.Number,
  delegate: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "TeamInfo" })

const TeamTask = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed", "cancelled", "blocked"]),
  priority: Schema.Literals(["high", "medium", "low"]),
  assignee: Schema.optional(Schema.String),
  depends_on: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "TeamTask" })

const TeamSessionResponse = Schema.NullOr(
  Schema.Struct({
    team: TeamInfo,
    tasks: Schema.Array(TeamTask),
    role: Schema.Literals(["lead", "member"]),
    memberName: Schema.optional(Schema.String),
  }),
).annotate({ identifier: "TeamSessionResponse" })

const TeamDelegateResponse = Schema.Struct({
  ok: Schema.Boolean,
  delegate: Schema.Boolean,
}).annotate({ identifier: "TeamDelegateResponse" })

const TeamCancelResponse = Schema.Struct({
  ok: Schema.Boolean,
  cancelled: Schema.Number,
}).annotate({ identifier: "TeamCancelResponse" })

const TeamApprovePlanResponse = Schema.Struct({
  ok: Schema.Boolean,
  approved: Schema.Boolean,
}).annotate({ identifier: "TeamApprovePlanResponse" })

const TeamShutdownResponse = Schema.Struct({
  ok: Schema.Boolean,
  status: TeamMemberStatus,
}).annotate({ identifier: "TeamShutdownResponse" })

const TeamOkResponse = Schema.Struct({
  ok: Schema.Boolean,
}).annotate({ identifier: "TeamOkResponse" })

export const TeamDelegatePayload = Schema.Struct({
  enabled: Schema.Boolean,
})

export const TeamCancelPayload = Schema.Struct({
  member: Schema.optional(Schema.String),
})

export const TeamApprovePlanPayload = Schema.Struct({
  member: Schema.String,
  approved: Schema.Boolean,
  feedback: Schema.optional(Schema.String),
})

export const TeamShutdownPayload = Schema.Struct({
  member: Schema.String,
  reason: Schema.optional(Schema.String),
})

export const TeamCleanupPayload = Schema.Struct({})

export const TeamMessagePayload = Schema.Struct({
  agent: Schema.optional(Schema.String),
  to: Schema.String,
  text: Schema.String,
})

export class TeamApiError extends Schema.TaggedErrorClass<TeamApiError>()(
  "TeamApiError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export const TeamPaths = {
  list: "/team",
  get: "/team/:teamName",
  tasks: "/team/:teamName/tasks",
  bySession: "/team/by-session/:sessionID",
  delegate: "/team/:teamName/delegate",
  cancel: "/team/:teamName/cancel",
  approvePlan: "/team/:teamName/approve-plan",
  shutdown: "/team/:teamName/shutdown",
  cleanup: "/team/:teamName/cleanup",
  message: "/session/:sessionID/team-message",
} as const

export const TeamApi = HttpApi.make("team").add(
  HttpApiGroup.make("team")
    .add(
      HttpApiEndpoint.get("list", TeamPaths.list, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(TeamInfo), "Team list"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.list",
          summary: "List teams",
          description: "Return all active agent teams for the current project.",
        }),
      ),
      HttpApiEndpoint.get("get", TeamPaths.get, {
        params: { teamName: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(TeamInfo, "Team metadata"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.get",
          summary: "Get team",
          description: "Return metadata for an active agent team.",
        }),
      ),
      HttpApiEndpoint.get("tasks", TeamPaths.tasks, {
        params: { teamName: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(TeamTask), "Team task list"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.tasks",
          summary: "Get team tasks",
          description: "Return the shared task list for an agent team.",
        }),
      ),
      HttpApiEndpoint.get("bySession", TeamPaths.bySession, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: described(TeamSessionResponse, "Team metadata for a session"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.bySession",
          summary: "Get team by session",
          description: "Return the team, role, and shared task list for the provided session.",
        }),
      ),
      HttpApiEndpoint.post("delegate", TeamPaths.delegate, {
        params: { teamName: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: TeamDelegatePayload,
        success: described(TeamDelegateResponse, "Delegate mode updated"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.delegate",
          summary: "Set team delegate mode",
          description: "Toggle delegate mode for a team and update lead session write permissions.",
        }),
      ),
      HttpApiEndpoint.post("cancel", TeamPaths.cancel, {
        params: { teamName: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: TeamCancelPayload,
        success: described(TeamCancelResponse, "Cancelled teammate runs"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.cancel",
          summary: "Cancel teammate work",
          description: "Cancel one teammate or all active teammates in a team.",
        }),
      ),
      HttpApiEndpoint.post("approvePlan", TeamPaths.approvePlan, {
        params: { teamName: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: TeamApprovePlanPayload,
        success: described(TeamApprovePlanResponse, "Plan approval updated"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.approvePlan",
          summary: "Approve or reject teammate plan",
          description: "Approve or reject a teammate's pending plan and update their write permissions.",
        }),
      ),
      HttpApiEndpoint.post("shutdown", TeamPaths.shutdown, {
        params: { teamName: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: TeamShutdownPayload,
        success: described(TeamShutdownResponse, "Shutdown requested"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.shutdown",
          summary: "Request teammate shutdown",
          description: "Ask a teammate to summarize and shut down gracefully.",
        }),
      ),
      HttpApiEndpoint.post("cleanup", TeamPaths.cleanup, {
        params: { teamName: Schema.String },
        query: WorkspaceRoutingQuery,
        payload: TeamCleanupPayload,
        success: described(TeamOkResponse, "Team cleaned up"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.cleanup",
          summary: "Clean up team",
          description: "Remove team resources after all teammates have shut down.",
        }),
      ),
      HttpApiEndpoint.post("message", TeamPaths.message, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        payload: TeamMessagePayload,
        success: described(TeamOkResponse, "Message sent"),
        error: TeamApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "team.message",
          summary: "Send team message",
          description: "Send a direct message from the current team session to another teammate or the lead.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "team",
        description: "Experimental agent team routes.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
