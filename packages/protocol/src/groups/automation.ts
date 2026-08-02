import { Schema } from "effect"
import { Context } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Session } from "@opencode-ai/schema/session"
import { Location } from "@opencode-ai/schema/location"
import { AutomationNotFoundError, AutomationLockError, AutomationPromptConflictError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

const BoundedLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))

const Schedule = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("cron"),
    expression: Schema.String.annotate({ description: "Cron expression (e.g. '0 9 * * 1-5')" }),
  }),
  Schema.Struct({
    type: Schema.Literal("webhook"),
    path: Schema.String.annotate({ description: "Webhook path (e.g. '/github/push')" }),
    secret: Schema.String.pipe(Schema.optional).annotate({ description: "Optional HMAC secret for verification" }),
  }),
])

const Trigger = Schema.Struct({
  id: Schema.String,
  sessionID: Session.ID,
  name: Schema.String,
  prompt: Schema.String,
  schedule: Schedule,
  enabled: Schema.Boolean,
  agent: Schema.String.pipe(Schema.optional),
  lastFired: Schema.Number.pipe(Schema.optional),
  locked: Schema.Boolean,
  lockOwner: Schema.String.pipe(Schema.optional),
  lockExpires: Schema.Number.pipe(Schema.optional),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
})

const RunStatus = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("running"),
  Schema.Literal("completed"),
  Schema.Literal("failed"),
  Schema.Literal("cancelled"),
])

const Run = Schema.Struct({
  id: Schema.String,
  triggerID: Schema.String,
  sessionID: Session.ID,
  status: RunStatus,
  prompt: Schema.String,
  agent: Schema.String.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
  payload: Schema.Unknown.pipe(Schema.optional),
  timeStarted: Schema.Number,
  timeCompleted: Schema.Number.pipe(Schema.optional),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
})

export const makeAutomationGroup = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
) =>
HttpApiGroup.make("server.automation")
  .add(
    HttpApiEndpoint.get("automation.list", "/api/automation", {
      query: Schema.Struct({ ...LocationQuery.fields, sessionID: Schema.optional(Session.ID) }),
      success: Location.response(Schema.Array(Trigger)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.automation.list",
          summary: "List automation triggers",
          description: "List all automation triggers for the location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("automation.get", "/api/automation/:id", {
      params: { id: Schema.String },
      success: Trigger,
      error: [AutomationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.automation.get",
        summary: "Get automation trigger",
        description: "Get an automation trigger by ID.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("automation.create", "/api/automation", {
      payload: Schema.Struct({
        id: Schema.String.pipe(Schema.optional),
        sessionID: Session.ID,
        name: Schema.String,
        prompt: Schema.String,
        schedule: Schedule,
        enabled: Schema.Boolean.pipe(Schema.optional),
        agent: Schema.String.pipe(Schema.optional),
      }),
      success: Trigger,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.automation.create",
        summary: "Create automation trigger",
        description: "Create a new automation trigger that fires a prompt into a session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("automation.update", "/api/automation/:id", {
      params: { id: Schema.String },
      payload: Schema.Struct({
        name: Schema.String.pipe(Schema.optional),
        prompt: Schema.String.pipe(Schema.optional),
        enabled: Schema.Boolean.pipe(Schema.optional),
        agent: Schema.String.pipe(Schema.optional),
      }),
      success: Trigger,
      error: [AutomationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.automation.update",
        summary: "Update automation trigger",
        description: "Update an existing automation trigger.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("automation.remove", "/api/automation/:id", {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.automation.remove",
        summary: "Remove automation trigger",
        description: "Delete an automation trigger.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("automation.fire", "/api/automation/:id/fire", {
      params: { id: Schema.String },
      payload: Schema.Struct({
        payload: Schema.Unknown.pipe(Schema.optional).annotate({ description: "Optional payload to pass to the prompt (e.g., webhook body)" }),
      }).pipe(Schema.optional),
      success: Run,
      error: [AutomationNotFoundError, AutomationLockError, AutomationPromptConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.automation.fire",
        summary: "Fire automation trigger",
        description: "Manually fire an automation trigger, sending its prompt to the session. Returns the run record.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("automation.webhook", "/api/automation/:id/webhook", {
      params: { id: Schema.String },
      success: Run,
      error: [AutomationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.automation.webhook",
        summary: "Receive webhook for automation trigger",
        description:
          "Raw webhook endpoint. If the trigger has a secret, the request must include an X-Hub-Signature-256 header (sha256=<hex>) that HMAC-SHA256-verifies against the raw body using the stored secret. Used by external services like GitHub. The webhook body is passed as payload to the prompt.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("automation.runs.list", "/api/automation/runs", {
      query: Schema.Struct({
        ...LocationQuery.fields,
        triggerID: Schema.optional(Schema.String),
        sessionID: Schema.optional(Session.ID),
        status: Schema.optional(RunStatus),
        limit: Schema.optional(Schema.NumberFromString.pipe(Schema.decodeTo(BoundedLimit))).annotate({ description: "Maximum number of runs to return (default 50)" }),
      }),
      success: Location.response(Schema.Array(Run)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.automation.runs.list",
          summary: "List automation runs",
          description: "List all automation runs, optionally filtered by trigger, session, or status.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("automation.runs.get", "/api/automation/runs/:id", {
      params: { id: Schema.String },
      success: Run,
      error: [AutomationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.automation.runs.get",
        summary: "Get automation run",
        description: "Get an automation run by ID.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "automation",
      description: "Automation triggers that fire prompts into sessions on a schedule or event.",
    }),
  )
  .middleware(locationMiddleware)