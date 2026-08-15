import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { DecisionVerbs } from "@/decision/verbs"

export const CommitParameters = Schema.Struct({
  action: Schema.String.annotate({ description: "Disposition action (e.g. advance, reject, offer, hire, note)" }),
  target_id: Schema.optional(Schema.String).annotate({ description: "Opaque target id (candidate id)" }),
  target_kind: Schema.optional(Schema.String).annotate({ description: "Opaque target kind (usually candidate)" }),
  reason: Schema.optional(Schema.String).annotate({ description: "Human reason for the disposition" }),
})

export const StatusParameters = Schema.Struct({
  id: Schema.optional(Schema.String).annotate({ description: "Filter by receipt id" }),
  commit_id: Schema.optional(Schema.String).annotate({ description: "Filter by commit id" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max receipts to show (default 20)" }),
})

export const PushParameters = Schema.Struct({
  commit_id: Schema.String.annotate({ description: "Git commit SHA to push" }),
  dry_run: Schema.optional(Schema.Boolean).annotate({
    description: "Dry-run (default true). Set false to write to the mock ATS",
  }),
  confirm: Schema.optional(Schema.Boolean).annotate({
    description: "Required for adverse actions (reject, offer, hire)",
  }),
})

export const CommitTool = Tool.define("commit", Effect.succeed({
  description:
    "Record a hiring disposition as a git audit commit. Same as `moks commit`. Does not write to the ATS. Prefer this over bash. Adverse actions (reject, offer, hire) still need confirm on push.",
  parameters: CommitParameters,
  execute: (params: Schema.Schema.Type<typeof CommitParameters>, ctx: Tool.Context) =>
    Effect.gen(function* () {
      yield* ctx.ask({
        permission: "commit",
        patterns: ["*"],
        always: ["*"],
        metadata: { action: params.action },
      })
      const instance = yield* InstanceState.context
      const result = yield* Effect.promise(() =>
        DecisionVerbs.commit({
          action: params.action,
          target:
            params.target_id || params.target_kind
              ? { kind: params.target_kind ?? "unknown", id: params.target_id }
              : undefined,
          reason: params.reason,
          source: "tool",
          cwd: instance.directory,
        }),
      )
      return {
        title: `committed ${result.receipt.action}`,
        output: JSON.stringify(result, null, 2),
        metadata: result,
      }
    }).pipe(Effect.orDie),
}))

export const StatusTool = Tool.define("status", Effect.succeed({
  description: "List hiring commits and unpushed open commits. Same as `moks status`. Prefer this over bash.",
  parameters: StatusParameters,
  execute: (params: Schema.Schema.Type<typeof StatusParameters>, ctx: Tool.Context) =>
    Effect.gen(function* () {
      yield* ctx.ask({
        permission: "status",
        patterns: ["*"],
        always: ["*"],
        metadata: {},
      })
      const instance = yield* InstanceState.context
      const result = yield* Effect.promise(() =>
        DecisionVerbs.status({
          id: params.id,
          commit_id: params.commit_id,
          limit: params.limit,
          cwd: instance.directory,
        }),
      )
      return {
        title: `${result.open.length} open`,
        output: JSON.stringify(result, null, 2),
        metadata: result,
      }
    }).pipe(Effect.orDie),
}))

export const PushTool = Tool.define("push", Effect.succeed({
  description:
    "Push a committed disposition to the ATS (mock). Same as `moks push`. Dry-run by default. Adverse actions (reject, offer, hire) require confirm=true. Prefer this over bash. Never auto-push.",
  parameters: PushParameters,
  execute: (params: Schema.Schema.Type<typeof PushParameters>, ctx: Tool.Context) =>
    Effect.gen(function* () {
      yield* ctx.ask({
        permission: "push",
        patterns: ["*"],
        always: ["*"],
        metadata: { commit_id: params.commit_id },
      })
      const instance = yield* InstanceState.context
      const result = yield* Effect.promise(() =>
        DecisionVerbs.push({
          commit_id: params.commit_id,
          dry_run: params.dry_run,
          confirm: params.confirm,
          source: "tool",
          cwd: instance.directory,
        }),
      )
      return {
        title: result.ok ? `pushed ${result.receipt.action}` : result.code,
        output: JSON.stringify(result, null, 2),
        metadata: result,
      }
    }).pipe(Effect.orDie),
}))
