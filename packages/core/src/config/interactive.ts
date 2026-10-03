export * as ConfigInteractive from "./interactive"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

/** `interactive_wait` deadline hard cap in ms (spec R13). */
export const MAX_WAIT_TIMEOUT_MS = 600_000
/** Job lifetime hard cap in ms (spec R7/R20). */
export const MAX_JOB_LIFETIME_MS = 3_600_000

/**
 * `interactive.*` config keys for the V2 interactive tool family
 * (specs/tool-interactive.md, Configuration). All keys are optional; defaults
 * are applied by the governor (`InteractiveGovernor`), not here — matching
 * `ConfigToolOutput`. Chunk bounds are intentionally NOT part of this block:
 * per-result bounding reuses `tool_output.{max_lines,max_bytes}` (spec R25).
 */
export class Info extends Schema.Class<Info>("ConfigV2.Interactive")({
  max_jobs: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum live interactive jobs per session (default 3)",
  }),
  max_exchanges: PositiveInt.pipe(Schema.optional).annotate({
    description: "Settled interactive results per job before auto-cancel (default 20)",
  }),
  quiet_window_ms: PositiveInt.pipe(Schema.optional).annotate({
    description: "Milliseconds of zero new output before an alive job counts as waiting (default 500)",
  }),
  wait_timeout_ms: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_WAIT_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({
      description: `Default interactive_wait deadline in ms (default 120000, max ${MAX_WAIT_TIMEOUT_MS})`,
    }),
  default_timeout_ms: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_JOB_LIFETIME_MS))
    .pipe(Schema.optional)
    .annotate({
      description: `Default job lifetime in ms (default 900000, max ${MAX_JOB_LIFETIME_MS})`,
    }),
  max_spool_bytes: PositiveInt.pipe(Schema.optional).annotate({
    description: "Spool file cap in bytes; past the cap the spool stops appending (default 8388608)",
  }),
}) {}
