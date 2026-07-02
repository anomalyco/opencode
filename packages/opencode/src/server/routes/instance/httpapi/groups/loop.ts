import { Loop } from "@/loop/loop"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { ApiNotFoundError } from "../errors"
import { described } from "./metadata"
import { Schema } from "effect"

const root = "/loop"

export const ListQuery = Schema.Struct(WorkspaceRoutingQueryFields)

export const LoopPaths = {
  list: root,
  create: root,
  get: `${root}/:loopID`,
  pause: `${root}/:loopID/pause`,
  resume: `${root}/:loopID/resume`,
  cancel: `${root}/:loopID/cancel`,
} as const

export const LoopApi = HttpApi.make("loop").add(
  HttpApiGroup.make("loop")
    .add(
      HttpApiEndpoint.get("list", LoopPaths.list, {
        query: ListQuery,
        success: described(Schema.Array(Loop.Info), "List of loops"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "loop.list",
          summary: "List loops",
          description: "List loops known to the server, most recently created first.",
        }),
      ),
      HttpApiEndpoint.get("get", LoopPaths.get, {
        params: { loopID: Loop.LoopID },
        query: WorkspaceRoutingQuery,
        success: described(Loop.Info, "Get loop"),
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "loop.get",
          summary: "Get loop",
          description: "Retrieve the current state of a loop, including its iteration history.",
        }),
      ),
      HttpApiEndpoint.post("create", LoopPaths.create, {
        query: WorkspaceRoutingQuery,
        payload: Loop.CreateInput,
        success: described(Loop.Info, "Successfully created loop"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "loop.create",
          summary: "Create loop",
          description:
            "Start a loop that repeats a prompt until it signals completion, hits the max iteration count, or stalls with no progress.",
        }),
      ),
      HttpApiEndpoint.post("pause", LoopPaths.pause, {
        params: { loopID: Loop.LoopID },
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Loop paused"),
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "loop.pause",
          summary: "Pause loop",
          description: "Pause a running loop before its next iteration.",
        }),
      ),
      HttpApiEndpoint.post("resume", LoopPaths.resume, {
        params: { loopID: Loop.LoopID },
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Loop resumed"),
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "loop.resume",
          summary: "Resume loop",
          description: "Resume a paused loop.",
        }),
      ),
      HttpApiEndpoint.post("cancel", LoopPaths.cancel, {
        params: { loopID: Loop.LoopID },
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Loop cancelled"),
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "loop.cancel",
          summary: "Cancel loop",
          description: "Cancel a running or paused loop.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "loop",
        description: "Experimental HttpApi loop routes.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
