export * as ConfigTeamJulesV1 from "./teamjules"

import { Schema } from "effect"
import { ConfigPermissionV1 } from "./permission"

export const TeamJulesAgentConfig = Schema.Struct({
  model: Schema.optional(Schema.String).annotate({
    description: "Model for TeamJules worker (format: provider/model)",
  }),
  prompt: Schema.optional(Schema.String).annotate({
    description: "System prompt for TeamJules autonomous worker",
  }),
  permission: Schema.optional(ConfigPermissionV1.Info),
})

export const TeamJulesConfig = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable TeamJules async coding tasks",
  }),
  webhook_port: Schema.optional(Schema.Number).annotate({
    description: "Port for GitHub webhook server (default: 3000)",
  }),
  webhook_secret: Schema.optional(Schema.String).annotate({
    description: "GitHub webhook secret for signature verification",
  }),
  worker_concurrency: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of concurrent task workers (default: 1)",
  }),
  task_timeout_ms: Schema.optional(Schema.Number).annotate({
    description: "Task execution timeout in milliseconds (default: 30 minutes)",
  }),
  agent: Schema.optional(TeamJulesAgentConfig).annotate({
    description: "TeamJules worker agent configuration",
  }),
}).annotate({
  identifier: "TeamJulesConfig",
  description: "TeamJules async coding task configuration",
})

export type TeamJulesConfig = typeof TeamJulesConfig.Type
