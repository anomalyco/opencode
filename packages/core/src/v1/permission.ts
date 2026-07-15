export * as PermissionV1 from "./permission"

import { Schema } from "effect"
export * from "@opencode-ai/schema/permission-v1"
import { ID } from "@opencode-ai/schema/permission-v1"

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    const rules = this.ruleset
    const cruise =
      Array.isArray(rules) &&
      rules.some((rule) => {
        if (!rule || typeof rule !== "object") return false
        if ("action" in rule && rule.action === "cruise_control") return true
        if ("module" in rule && rule.module === "cruise_control") return true
        return false
      })
    if (cruise) {
      return `Tool execution is being blocked by a permission rule (cruise_control). Run /cruise-control-model or adjust permission rules. Relevant rules: ${JSON.stringify(rules)}`
    }
    return `Tool execution is being blocked by a permission rule. Relevant rules: ${JSON.stringify(this.ruleset)}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Permission.NotFoundError", {
  requestID: ID,
}) {}

export type Error = DeniedError | RejectedError | CorrectedError
