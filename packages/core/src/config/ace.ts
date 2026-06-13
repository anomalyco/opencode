export * as ConfigACE from "./ace"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"

export const Mode = Schema.Literals(["monitor", "fixed-cap", "reject-escalate"])
export type Mode = typeof Mode.Type

export class Experiment extends Schema.Class<Experiment>("ConfigV2.ACE.Experiment")({
  name: Schema.String.pipe(Schema.optional),
  arm: Schema.String.pipe(Schema.optional),
}) {}

export class Limits extends Schema.Class<Limits>("ConfigV2.ACE.Limits")({
  toolCallsPerSession: NonNegativeInt.pipe(Schema.optional),
  toolCallsPerTurn: NonNegativeInt.pipe(Schema.optional),
  spawnsPerSession: NonNegativeInt.pipe(Schema.optional),
  spawnDepth: NonNegativeInt.pipe(Schema.optional),
  parallelSubagents: NonNegativeInt.pipe(Schema.optional),
  windowMs: PositiveInt.pipe(Schema.optional),
}) {}

export class Trace extends Schema.Class<Trace>("ConfigV2.ACE.Trace")({
  events: Schema.Boolean.pipe(Schema.optional),
  logs: Schema.Boolean.pipe(Schema.optional),
}) {}

export const ExecutionModeType = Schema.Literals(["one_click_autonomous", "require_human_approval"])
export type ExecutionModeType = typeof ExecutionModeType.Type

export class ExecutionMode extends Schema.Class<ExecutionMode>("ConfigV2.ACE.Headless.ExecutionMode")({
  type: ExecutionModeType.pipe(Schema.optional),
  requireHumanApproval: Schema.Boolean.pipe(Schema.optional),
  maxRetriesOnVerifyFail: NonNegativeInt.pipe(Schema.optional),
  timeoutMs: PositiveInt.pipe(Schema.optional),
}) {}

export class ToolAccessRights extends Schema.Class<ToolAccessRights>("ConfigV2.ACE.Headless.ToolAccessRights")({
  filesystem: Schema.Array(Schema.String).pipe(Schema.optional),
  shellExecution: Schema.Array(Schema.String).pipe(Schema.optional),
  gitOperations: Schema.Array(Schema.String).pipe(Schema.optional),
  forbiddenCommands: Schema.Array(Schema.String).pipe(Schema.optional),
}) {}

export class OutputConstraints extends Schema.Class<OutputConstraints>("ConfigV2.ACE.Headless.OutputConstraints")({
  allowConversationalPreamble: Schema.Boolean.pipe(Schema.optional),
  allowPostExecutionSummary: Schema.Boolean.pipe(Schema.optional),
  requireSelfVerification: Schema.Boolean.pipe(Schema.optional),
  format: Schema.String.pipe(Schema.optional),
}) {}

export class Headless extends Schema.Class<Headless>("ConfigV2.ACE.Headless")({
  executionMode: ExecutionMode.pipe(Schema.optional),
  toolAccessRights: ToolAccessRights.pipe(Schema.optional),
  outputConstraints: OutputConstraints.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.ACE")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  mode: Mode.pipe(Schema.optional),
  experiment: Experiment.pipe(Schema.optional),
  limits: Limits.pipe(Schema.optional),
  trace: Trace.pipe(Schema.optional),
  headless: Headless.pipe(Schema.optional),
  maxSteps: NonNegativeInt.pipe(Schema.optional),
  maxSpawns: NonNegativeInt.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
}) {}
