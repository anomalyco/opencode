export * as ConfigExperimental from "./experimental.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "../schema.js"
import { ConfigModel } from "./model.js"
import { ConfigPolicy } from "./policy.js"

export class DecisionGate extends Schema.Class<DecisionGate>("ConfigExperimental.DecisionGate")({
  mode: Schema.Literals(["observe", "route"]).annotate({
    description:
      "`observe` logs what the gate would decide without changing anything. `route` sends the first step of messages the gate is confident are plain chat to the fast model.",
  }),
  model: ConfigModel.Selection.pipe(optional).annotate({
    description: "Fast model for routed messages. Defaults to the small model of the session's provider.",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  portable_shell_scanner: Schema.Boolean.pipe(optional).annotate({
    description: "Enable the experimental portable shell permission scanner. Defaults to false.",
  }),
  subagent_depth: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  decision_gate: DecisionGate.pipe(optional).annotate({
    description: "Classify each new message before the model call and route plain chat to a fast model.",
  }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Deprecated: use top-level policies. Ordered policies controlling access to configured resources",
  }),
}) {}
