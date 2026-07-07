export * as ConfigWorkflowV1 from "./workflow"

import { Schema } from "effect"

export const Info = Schema.Struct({
  planner: Schema.optional(Schema.String).annotate({
    description: "Agent that plans work before implementation. Defaults to 'plan'.",
  }),
  worker: Schema.optional(Schema.String).annotate({
    description: "Agent that implements approved plans. Defaults to 'build'.",
  }),
  reviewer: Schema.optional(Schema.String).annotate({
    description:
      "Agent that reviews the worker's implementation. Defaults to 'review'. The worker hands the session off for review via the review_exit tool.",
  }),
}).annotate({ identifier: "WorkflowConfig" })
export type Info = Schema.Schema.Type<typeof Info>

// The reviewer stage is opt-in: it only activates when a `workflow` config is present.
export function roles(workflow: Info | undefined) {
  return {
    planner: workflow?.planner ?? "plan",
    worker: workflow?.worker ?? "build",
    reviewer: workflow ? (workflow.reviewer ?? "review") : undefined,
  }
}
