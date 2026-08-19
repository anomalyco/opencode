import * as AgentPresence from "@/agent/presence"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/agents"

export const AgentsApi = HttpApi.make("agents").add(
  HttpApiGroup.make("agents")
    .add(
      HttpApiEndpoint.get("list", root, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(AgentPresence.Info), "Metadata-only Agent presence records"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "agents.list",
          summary: "List Agent presence",
          description: "List live Agent metadata for this opencode instance without session content.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware),
)
