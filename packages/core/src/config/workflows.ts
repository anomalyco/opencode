export * as ConfigWorkflows from "./workflows"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

const Models = Schema.Struct({
  planner: Schema.String.pipe(Schema.optional),
  worker: Schema.String.pipe(Schema.optional),
  writer: Schema.String.pipe(Schema.optional),
  assessor: Schema.String.pipe(Schema.optional),
  synthesizer: Schema.String.pipe(Schema.optional),
})

const Workflow = Schema.Literals(["heavy", "council", "research"])
const CouncilMode = Schema.Literals(["auto", "synthesis", "required", "always", "off"])

export class Recursion extends Schema.Class<Recursion>("ConfigV2.Workflows.Recursion")({
  max_depth: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum Heavy/Council delegation depth across one root workflow",
  }),
  max_workflows: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum Heavy/Council invocations across one root workflow",
  }),
  max_concurrency: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum active workflow child sessions shared by the complete recursive workflow tree",
  }),
  max_councils: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum distinct Council invocations across one root workflow after duplicate reuse",
  }),
  debate_deduplication: Schema.Literals(["off", "exact", "semantic"]).pipe(Schema.optional).annotate({
    description:
      "Root-scoped Council coordination: defaults to semantic reuse for strongly overlapping issues over compatible evidence; recursive Councils must address a materially narrower dispute",
  }),
}) {}

export class Reports extends Schema.Class<Reports>("ConfigV2.Workflows.Reports")({
  directory: Schema.String.pipe(Schema.optional).annotate({
    description: "Directory for Markdown workflow reports, relative to the active Location",
  }),
  max_prompt_bytes: PositiveInt.pipe(Schema.optional).annotate({
    description:
      "Maximum UTF-8 prompt size for a workflow stage; oversized prompts fail visibly without truncating reports",
  }),
  finalization_retries: PositiveInt.pipe(Schema.optional).annotate({
    description:
      "Maximum retries after a transient provider failure while finalizing a workflow stage; defaults to one",
  }),
}) {}

export class Heavy extends Schema.Class<Heavy>("ConfigV2.Workflows.Heavy")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  council: Schema.Union([Schema.Boolean, CouncilMode]).pipe(Schema.optional).annotate({
    description:
      "Council routing policy: auto reviews planner- or worker-identified disputes, synthesis reviews every Heavy synthesis, required guarantees a root review, and off disables Heavy-to-Council delegation; always remains an alias for required",
  }),
  delegates: Schema.Array(Workflow).pipe(Schema.optional).annotate({
    description: "Workflow types that Heavy stages may recursively spawn; defaults to Heavy and Council",
  }),
  max_depth: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum internal Heavy planning depth; separate from cross-workflow recursion.max_depth",
  }),
  tasks_per_node: PositiveInt.pipe(Schema.optional),
  max_nodes: PositiveInt.pipe(Schema.optional),
  concurrency: PositiveInt.pipe(Schema.optional),
  child_timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum runtime in milliseconds for one Heavy child session",
  }),
  mutation: Schema.Literal("serial").pipe(Schema.optional),
  on_failure: Schema.Literals(["keep", "stop"]).pipe(Schema.optional),
  models: Models.pipe(Schema.optional),
}) {}

export class Debate extends Schema.Class<Debate>("ConfigV2.Workflows.Debate")({
  mode: Schema.Literals(["auto", "always", "off"]).pipe(Schema.optional),
  topics: PositiveInt.pipe(Schema.optional),
  participants: PositiveInt.pipe(Schema.optional),
  rounds: PositiveInt.pipe(Schema.optional),
}) {}

export class Council extends Schema.Class<Council>("ConfigV2.Workflows.Council")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  delegates: Schema.Array(Workflow).pipe(Schema.optional).annotate({
    description: "Workflow types that Council stages may recursively spawn; defaults to Heavy and Council",
  }),
  perspectives: PositiveInt.pipe(Schema.optional),
  concurrency: PositiveInt.pipe(Schema.optional),
  child_timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum runtime in milliseconds for one Council child session",
  }),
  debate: Debate.pipe(Schema.optional),
  models: Schema.Struct({
    planner: Schema.String.pipe(Schema.optional),
    perspective: Schema.String.pipe(Schema.optional),
    debater: Schema.String.pipe(Schema.optional),
    synthesizer: Schema.String.pipe(Schema.optional),
  }).pipe(Schema.optional),
}) {}

export class Research extends Schema.Class<Research>("ConfigV2.Workflows.Research")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  effort: Schema.Literals(["standard", "deep", "frontier"]).pipe(Schema.optional).annotate({
    description: "Research budget preset; explicit limits below override the preset",
  }),
  capability: Schema.Literals(["read", "write"]).pipe(Schema.optional).annotate({
    description: "Whether Research branches are read-only or may mutate and validate the workspace",
  }),
  delegates: Schema.Array(Workflow).pipe(Schema.optional).annotate({
    description: "Workflow types Research may spawn; defaults to Research and Council",
  }),
  max_depth: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum hierarchical Research branch depth",
  }),
  min_depth: PositiveInt.pipe(Schema.optional).annotate({
    description:
      "Target useful evidence depth for complex Research plans; deeper nested recursion is earned by post-wave assessment",
  }),
  max_branches_per_node: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum tasks automatically or explicitly promoted to recursive branches at one Research node",
  }),
  min_evidence_per_branch: PositiveInt.pipe(Schema.optional).annotate({
    description: "Minimum child evidence-task slots reserved before a recursive Research branch may start",
  }),
  tasks_per_wave: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum independent evidence tasks launched in one adaptive wave",
  }),
  max_waves: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum adaptive evidence waves at each Research node",
  }),
  max_nodes: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum evidence-task slots allocated hierarchically across one Research invocation",
  }),
  concurrency: PositiveInt.pipe(Schema.optional),
  child_timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum runtime in milliseconds for one Research child session",
  }),
  max_time: PositiveInt.pipe(Schema.optional).annotate({
    description: "Soft wall-clock budget in milliseconds; no new wave starts after it is exhausted",
  }),
  max_tokens: PositiveInt.pipe(Schema.optional).annotate({
    description: "Soft child-session token budget; no new wave starts after it is exhausted",
  }),
  debate_sensitivity: Schema.Literals(["off", "low", "balanced", "high"]).pipe(Schema.optional).annotate({
    description: "How readily consequential contradictions are routed to Council",
  }),
  max_debates_per_node: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum evidence-grounded Council disputes reviewed at one Research node",
  }),
  freshness_days: PositiveInt.pipe(Schema.optional).annotate({
    description: "Requested maximum source age in days when fresher evidence exists",
  }),
  minimum_report_words: PositiveInt.pipe(Schema.optional).annotate({
    description: "Minimum word count for the standalone root report before evidence status is marked partial",
  }),
  on_failure: Schema.Literals(["keep", "stop"]).pipe(Schema.optional),
  models: Models.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Workflows")({
  recursion: Recursion.pipe(Schema.optional),
  reports: Reports.pipe(Schema.optional),
  heavy: Schema.Union([Schema.Boolean, Heavy]).pipe(Schema.optional),
  council: Schema.Union([Schema.Boolean, Council]).pipe(Schema.optional),
  research: Schema.Union([Schema.Boolean, Research]).pipe(Schema.optional),
}) {}

export function merge(inputs: ReadonlyArray<Info | undefined>): Info | undefined {
  const configured = inputs.filter((input): input is Info => input !== undefined)
  if (configured.length === 0) return undefined
  return Info.make({
    recursion: configured.reduce<Recursion | undefined>(
      (previous, input) => mergeRecursion(previous, input.recursion),
      undefined,
    ),
    reports: configured.reduce<Reports | undefined>(
      (previous, input) => mergeReports(previous, input.reports),
      undefined,
    ),
    heavy: configured.reduce<boolean | Heavy | undefined>(
      (previous, input) => mergeHeavy(previous, input.heavy),
      undefined,
    ),
    council: configured.reduce<boolean | Council | undefined>(
      (previous, input) => mergeCouncil(previous, input.council),
      undefined,
    ),
    research: configured.reduce<boolean | Research | undefined>(
      (previous, input) => mergeResearch(previous, input.research),
      undefined,
    ),
  })
}

function mergeHeavy(previous: boolean | Heavy | undefined, next: boolean | Heavy | undefined) {
  if (next === undefined) return previous
  if (typeof next === "boolean" || typeof previous !== "object") return next
  return Heavy.make({
    enabled: next.enabled ?? previous.enabled,
    council: next.council ?? previous.council,
    delegates: next.delegates ?? previous.delegates,
    max_depth: next.max_depth ?? previous.max_depth,
    tasks_per_node: next.tasks_per_node ?? previous.tasks_per_node,
    max_nodes: next.max_nodes ?? previous.max_nodes,
    concurrency: next.concurrency ?? previous.concurrency,
    child_timeout: next.child_timeout ?? previous.child_timeout,
    mutation: next.mutation ?? previous.mutation,
    on_failure: next.on_failure ?? previous.on_failure,
    models: next.models ? { ...previous.models, ...next.models } : previous.models,
  })
}

function mergeCouncil(previous: boolean | Council | undefined, next: boolean | Council | undefined) {
  if (next === undefined) return previous
  if (typeof next === "boolean" || typeof previous !== "object") return next
  return Council.make({
    enabled: next.enabled ?? previous.enabled,
    delegates: next.delegates ?? previous.delegates,
    perspectives: next.perspectives ?? previous.perspectives,
    concurrency: next.concurrency ?? previous.concurrency,
    child_timeout: next.child_timeout ?? previous.child_timeout,
    debate: next.debate
      ? Debate.make({
          mode: next.debate.mode ?? previous.debate?.mode,
          topics: next.debate.topics ?? previous.debate?.topics,
          participants: next.debate.participants ?? previous.debate?.participants,
          rounds: next.debate.rounds ?? previous.debate?.rounds,
        })
      : previous.debate,
    models: next.models ? { ...previous.models, ...next.models } : previous.models,
  })
}

function mergeResearch(previous: boolean | Research | undefined, next: boolean | Research | undefined) {
  if (next === undefined) return previous
  if (typeof next === "boolean" || typeof previous !== "object") return next
  return Research.make({
    enabled: next.enabled ?? previous.enabled,
    effort: next.effort ?? previous.effort,
    capability: next.capability ?? previous.capability,
    delegates: next.delegates ?? previous.delegates,
    max_depth: next.max_depth ?? previous.max_depth,
    min_depth: next.min_depth ?? previous.min_depth,
    max_branches_per_node: next.max_branches_per_node ?? previous.max_branches_per_node,
    min_evidence_per_branch: next.min_evidence_per_branch ?? previous.min_evidence_per_branch,
    tasks_per_wave: next.tasks_per_wave ?? previous.tasks_per_wave,
    max_waves: next.max_waves ?? previous.max_waves,
    max_nodes: next.max_nodes ?? previous.max_nodes,
    concurrency: next.concurrency ?? previous.concurrency,
    child_timeout: next.child_timeout ?? previous.child_timeout,
    max_time: next.max_time ?? previous.max_time,
    max_tokens: next.max_tokens ?? previous.max_tokens,
    debate_sensitivity: next.debate_sensitivity ?? previous.debate_sensitivity,
    max_debates_per_node: next.max_debates_per_node ?? previous.max_debates_per_node,
    freshness_days: next.freshness_days ?? previous.freshness_days,
    minimum_report_words: next.minimum_report_words ?? previous.minimum_report_words,
    on_failure: next.on_failure ?? previous.on_failure,
    models: next.models ? { ...previous.models, ...next.models } : previous.models,
  })
}

function mergeRecursion(previous: Recursion | undefined, next: Recursion | undefined) {
  if (!next) return previous
  return Recursion.make({
    max_depth: next.max_depth ?? previous?.max_depth,
    max_workflows: next.max_workflows ?? previous?.max_workflows,
    max_concurrency: next.max_concurrency ?? previous?.max_concurrency,
    max_councils: next.max_councils ?? previous?.max_councils,
    debate_deduplication: next.debate_deduplication ?? previous?.debate_deduplication,
  })
}

function mergeReports(previous: Reports | undefined, next: Reports | undefined) {
  if (!next) return previous
  return Reports.make({
    directory: next.directory ?? previous?.directory,
    max_prompt_bytes: next.max_prompt_bytes ?? previous?.max_prompt_bytes,
    finalization_retries: next.finalization_retries ?? previous?.finalization_retries,
  })
}
