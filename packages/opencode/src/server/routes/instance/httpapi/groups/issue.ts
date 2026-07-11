import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"
import { notFound } from "../errors"

const root = "/issue"

export const IssuePriority = Schema.Literals(["none", "urgent", "high", "medium", "low"])

export const IssueRecord = Schema.Struct({
  id: Schema.String,
  directory: Schema.String,
  parent_id: Schema.NullOr(Schema.String),
  level: Schema.Number,
  title: Schema.String,
  content: Schema.String,
  description: Schema.String,
  status: Schema.String,
  priority: IssuePriority,
  labels: Schema.Array(Schema.String),
  due_date: Schema.optional(Schema.NullOr(Schema.String)),
  assignee_id: Schema.optional(Schema.NullOr(Schema.String)),
  linear_issue_id: Schema.optional(Schema.NullOr(Schema.String)),
  linear_team_id: Schema.optional(Schema.NullOr(Schema.String)),
  linear_project_id: Schema.optional(Schema.NullOr(Schema.String)),
  position: Schema.Number,
  last_pushed_at: Schema.optional(Schema.NullOr(Schema.Number)),
  linear_updated_at: Schema.optional(Schema.NullOr(Schema.Number)),
  cloud_shadow: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  time_created: Schema.Number,
  time_updated: Schema.Number,
}).annotate({ identifier: "Issue" })

export const IssuePartial = Schema.Struct({
  id: Schema.optional(Schema.String),
  parent_id: Schema.optional(Schema.NullOr(Schema.String)),
  level: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  priority: Schema.optional(IssuePriority),
  labels: Schema.optional(Schema.Array(Schema.String)),
  due_date: Schema.optional(Schema.NullOr(Schema.String)),
  assignee_id: Schema.optional(Schema.NullOr(Schema.String)),
  linear_issue_id: Schema.optional(Schema.NullOr(Schema.String)),
  linear_team_id: Schema.optional(Schema.NullOr(Schema.String)),
  linear_project_id: Schema.optional(Schema.NullOr(Schema.String)),
  position: Schema.optional(Schema.Number),
  last_pushed_at: Schema.optional(Schema.NullOr(Schema.Number)),
  linear_updated_at: Schema.optional(Schema.NullOr(Schema.Number)),
  cloud_shadow: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
})

export const IssueCreatePayload = Schema.Struct({
  issue: IssuePartial,
})

export const IssueUpdatePayload = Schema.Struct({
  patch: IssuePartial,
})

export const IssueReorderPayload = Schema.Struct({
  ids: Schema.Array(Schema.String),
})

export const AutoProgressStatusResponse = Schema.Struct({
  status: Schema.Literals(["idle", "running"]),
})

export const LinearBindingRecord = Schema.Struct({
  teamId: Schema.String,
  teamName: Schema.String,
  projectId: Schema.String,
  projectName: Schema.optional(Schema.String),
  projectUrl: Schema.optional(Schema.String),
}).annotate({ identifier: "LinearBinding" })

export const LinearBindingSetPayload = Schema.Struct({
  teamId: Schema.optional(Schema.String),
  teamName: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  projectName: Schema.optional(Schema.String),
  projectUrl: Schema.optional(Schema.String),
})

export const LinearTeam = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  key: Schema.optional(Schema.String),
})

export const LinearProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  state: Schema.optional(Schema.String),
})

export const LinearUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
})

export const LinearStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.optional(Schema.String),
})

export const LinearProjectsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  team: Schema.optional(Schema.String),
})

export const SyncPullResponse = Schema.Struct({
  pulled: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
  ids: Schema.Array(Schema.String),
  errors: Schema.Array(
    Schema.Struct({
      linearIssueId: Schema.String,
      error: Schema.String,
    }),
  ),
})

export const SyncPushResponse = Schema.Struct({
  pushed: Schema.Number,
  failed: Schema.Number,
  ids: Schema.Array(Schema.String),
  errors: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      message: Schema.String,
    }),
  ),
})

export const IssuePaths = {
  list: root,
  get: `${root}/{id}`,
  create: root,
  update: `${root}/{id}`,
  delete: `${root}/{id}`,
  reorder: `${root}/reorder`,
  autoProgressStart: `${root}/auto-progress/start`,
  autoProgressStop: `${root}/auto-progress/stop`,
  autoProgressStatus: `${root}/auto-progress/status`,
  linearBindingGet: `${root}/linear/binding`,
  linearBindingSet: `${root}/linear/binding`,
  linearTeams: `${root}/linear/teams`,
  linearProjects: `${root}/linear/projects`,
  linearUsers: `${root}/linear/users`,
  linearStatuses: `${root}/linear/statuses`,
  syncPull: `${root}/sync/pull`,
  syncPush: `${root}/sync/push`,
} as const

export const IssueApi = HttpApi.make("issue")
  .add(
    HttpApiGroup.make("issue")
      .add(
        HttpApiEndpoint.get("list", IssuePaths.list, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(IssueRecord), "Issue list"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.list",
            summary: "List issues",
            description: "List all issues (workspace-scoped todos) for the current project directory.",
          }),
        ),
        HttpApiEndpoint.get("get", IssuePaths.get, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(IssueRecord, "Issue"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.get",
            summary: "Get issue",
            description: "Get a single issue by id in the workspace.",
          }),
        ),
        HttpApiEndpoint.post("create", IssuePaths.create, {
          query: WorkspaceRoutingQuery,
          payload: IssueCreatePayload,
          success: described(IssueRecord, "Created issue"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.create",
            summary: "Create issue",
            description: "Create a new issue (todo) in the workspace.",
          }),
        ),
        HttpApiEndpoint.patch("update", IssuePaths.update, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: IssueUpdatePayload,
          success: described(IssueRecord, "Updated issue"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.update",
            summary: "Update issue",
            description: "Update fields on an existing issue.",
          }),
        ),
        HttpApiEndpoint.delete("delete", IssuePaths.delete, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Deleted"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.delete",
            summary: "Delete issue",
            description: "Delete an issue from the workspace.",
          }),
        ),
        HttpApiEndpoint.post("reorder", IssuePaths.reorder, {
          query: WorkspaceRoutingQuery,
          payload: IssueReorderPayload,
          success: described(Schema.Boolean, "Reordered"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.reorder",
            summary: "Reorder issues",
            description: "Reorder issues by providing a list of issue IDs in the new order.",
          }),
        ),
        HttpApiEndpoint.post("autoProgressStart", IssuePaths.autoProgressStart, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Started"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.autoProgressStart",
            summary: "Start auto-progress",
            description: "Start the L1/L2 auto-progress engine for a workspace directory.",
          }),
        ),
        HttpApiEndpoint.post("autoProgressStop", IssuePaths.autoProgressStop, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Stopped"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.autoProgressStop",
            summary: "Stop auto-progress",
            description: "Stop the L1/L2 auto-progress engine for a workspace directory.",
          }),
        ),
        HttpApiEndpoint.get("autoProgressStatus", IssuePaths.autoProgressStatus, {
          query: WorkspaceRoutingQuery,
          success: described(AutoProgressStatusResponse, "Status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.autoProgressStatus",
            summary: "Auto-progress status",
            description: "Whether the L1/L2 auto-progress engine is currently running for a workspace directory.",
          }),
        ),
        HttpApiEndpoint.get("linearBindingGet", IssuePaths.linearBindingGet, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.NullOr(LinearBindingRecord), "Linear binding or null"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.linearBindingGet",
            summary: "Get Linear workspace binding",
            description:
              "Returns the workspace-scoped Linear team/project binding or null if not configured. Per ADR-0004, binding is stored in <workspace>/.opencode/linear-binding.json.",
          }),
        ),
        HttpApiEndpoint.put("linearBindingSet", IssuePaths.linearBindingSet, {
          query: WorkspaceRoutingQuery,
          payload: LinearBindingSetPayload,
          success: described(Schema.NullOr(LinearBindingRecord), "The new binding (or null if cleared)"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.linearBindingSet",
            summary: "Set Linear workspace binding",
            description:
              "Writes the workspace-scoped Linear team/project binding. Accepts { teamId, teamName, projectId } to set, or null to clear.",
          }),
        ),
        HttpApiEndpoint.get("linearTeams", IssuePaths.linearTeams, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(LinearTeam), "Linear teams"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.linearTeams",
            summary: "List Linear workspace teams",
            description:
              "List teams in the connected Linear workspace via the Linear MCP list_teams tool. Returns an empty array if the Linear MCP is not connected.",
          }),
        ),
        HttpApiEndpoint.get("linearProjects", IssuePaths.linearProjects, {
          query: LinearProjectsQuery,
          success: described(Schema.Array(LinearProject), "Linear projects"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.linearProjects",
            summary: "List Linear workspace projects",
            description:
              "List projects in the connected Linear workspace via the Linear MCP list_projects tool. Supports optional team query param to filter by team.",
          }),
        ),
        HttpApiEndpoint.get("linearUsers", IssuePaths.linearUsers, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(LinearUser), "Linear users"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.linearUsers",
            summary: "List Linear workspace users",
            description:
              "List users in the connected Linear workspace via the Linear MCP list_users tool. Returns an empty array if the Linear MCP is not connected.",
          }),
        ),
        HttpApiEndpoint.get("linearStatuses", IssuePaths.linearStatuses, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(LinearStatus), "Linear issue statuses"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.linearStatuses",
            summary: "List Linear team issue statuses",
            description:
              "List the available Linear workflow states (statuses) for the configured team via the Linear MCP list_issue_statuses tool.",
          }),
        ),
        HttpApiEndpoint.post("syncPull", IssuePaths.syncPull, {
          query: WorkspaceRoutingQuery,
          success: described(SyncPullResponse, "Pull result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.syncPull",
            summary: "Pull issues from Linear",
            description:
              "Import Linear issues for the workspace into the local IssueTable. Uses the project's connected Linear MCP server.",
          }),
        ),
        HttpApiEndpoint.post("syncPush", IssuePaths.syncPush, {
          query: WorkspaceRoutingQuery,
          success: described(SyncPushResponse, "Push result"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "issue.syncPush",
            summary: "Push issues to Linear",
            description: "Push locally modified issues to Linear via the project's connected Linear MCP server.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "issue",
          description: "Issue (Todo) management routes — workspace-scoped, Linear-aligned.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode issue HttpApi",
      version: "0.0.1",
      description: "Issue management surface for workspace-scoped todos.",
    }),
  )

export { notFound }
