// CP-023 §7.7 / K106 — the classification registry for every production caller of
// `Session.updateMessage` and `Session.updatePart`.
//
// §7.7's row for this work reads: "Classify each caller as pre-fence leased execution,
// cancellation-owned ToolPart terminalization, exact closure capability, proven non-destructive
// update, or post-fence reject; no unclassified caller may ship."
//
// This file is the classification. `closure-update-inventory.ts` re-derives the caller set from
// source, and `closure-update-inventory.test.ts` diffs the two in BOTH directions — an unregistered
// caller fails, and a registered entry with no matching caller also fails. That second direction
// matters as much as the first: a stale entry is how a registry starts describing code that no
// longer exists and quietly loses authority.
//
// TAXONOMY NOTE. §7.3:1112's generic footprint vocabulary is "guarded, read-only, non-conversational
// residual, or explicitly out of scope with source evidence". §7.7:1365 specifies a DIFFERENT and
// narrower taxonomy for these callers specifically, and K107 names four of its five members
// verbatim. §7.7's is therefore primary here, because it is the vocabulary K107 must consume;
// §7.3's "explicitly out of scope with source evidence" is retained as `out_of_scope`, which is the
// one escape the §7.7 list does not provide.
import type { Tracked } from "./closure-update-inventory"

/** §7.7:1365's five, plus §7.3:1112's out-of-scope escape. */
export type Authority =
  /** Runs on a conversational execution path already covered by an admission lease. */
  | "pre_fence_leased_execution"
  /** A ToolPart terminalization performed while cancellation owns the write. */
  | "cancellation_owned_terminalization"
  /** A narrow closure-owned capability restricted to exact coordinates, not a mutation lease. */
  | "exact_closure_capability"
  /** Provably cannot alter state a fence protects. */
  | "proven_non_destructive_update"
  /** Must be refused while a fence stands; K108 owns the runtime half. */
  | "post_fence_reject"
  /**
   * Admitted by a CAPTURED Effect context rather than by a live lease, with safety supplied by a
   * per-site guard named in the claim's own evidence.
   *
   * A TAXONOMY EXTENSION BEYOND §7.7:1365's FIVE, added at Gate 4 and flagged as such. §7.7 offers
   * no member that is true of these callers: `pre_fence_leased_execution` asserts a live lease and
   * K107 measured that the lease is settled by the time a bridged call runs, so keeping that label
   * meant the registry was asserting something false. The remaining four are worse fits still — this
   * is neither a closure-owned capability nor a cancellation-owned terminalization, it is not
   * refused while a fence stands, and it is not non-destructive in general.
   *
   * WHAT THE CATEGORY CLAIMS, precisely: the write reaches the database through
   * `effect/bridge.ts:61`, which re-provides a Context captured inside an admitted body onto a NEW
   * ROOT FIBER started at `:64-67`. That fiber is not a child of the admitted fiber, so it outlives
   * `admitted`'s retirement `ensuring`. A captured context is a DESCRIPTION of a lease, not a hold
   * on one.
   *
   * WHAT IT DOES NOT CLAIM: any single safety story. The two `processor.ts` sites are safe because
   * they fresh-read the row and write only while it is still `running`/`pending`; `plan.ts::execute`
   * is safe for an unrelated reason — it mints new `MessageID`/`PartID` values and overwrites
   * nothing. Each claim's `evidence` carries its own argument, which is what this field is for. What
   * they share, and all that this label asserts, is the ADMISSION mechanism.
   *
   * WHY THIS IS NOT AN ADMISSION HOLE. What a bridged fiber writes is a completed tool's real
   * outcome — a record of finished work, which I-23 protects as immutable historical fidelity —
   * rather than new admissible work. Quiescence therefore need not enumerate these fibers.
   * FALSIFIER: if a bridged path could ever START executable work rather than record finished work,
   * this reverses and the path needs its own admission.
   */
  | "bridged_context_admission"
  /** Not an execution-capable product path (§7.3:1112's fourth disposition). */
  | "out_of_scope"

export type Claim = {
  readonly authority: Authority
  /**
   * The specific calls this claim covers, when a unit carries more than one authority story.
   *
   * Omitted means "every call in this unit". Lines are EVIDENCE, never key material — the registry
   * is keyed on `file::symbol` precisely so unrelated edits above a call do not invalidate it, and
   * recording lines here does not reintroduce that fragility.
   */
  readonly lines?: readonly number[]
  readonly evidence: string
}

export type Entry = {
  readonly file: string
  readonly symbol: string
  readonly claims: readonly Claim[]
  /**
   * A recorded open question where the grounding is genuinely incomplete.
   *
   * Deliberately NOT the same as unclassified. The caller is enumerated, its dominant authority is
   * evidenced, and the unproven path is named — that is a classification with a known edge, which is
   * honest. What K106 forbids is a caller nobody looked at. The inventory test requires every entry
   * carrying this field to also name the gate that resolves it, so an open question cannot sit here
   * indefinitely without an owner.
   */
  readonly uncertain?: string
  readonly resolveBy?: string
}

/**
 * Name collisions the scanner reports but which are not the tracked symbols.
 *
 * The scanner matches on property NAME regardless of receiver — that is exactly what lets it catch
 * `svc.updatePart(...)` through any handle spelling, and the unavoidable cost is that an unrelated
 * object with the same property name also matches. Those are acknowledged here WITH evidence rather
 * than filtered silently, so the exclusion is a decision on the record and a new unresolved item
 * still fails the test.
 */
export const EXCLUSIONS: readonly { readonly file: string; readonly line: number; readonly evidence: string }[] = [
  {
    file: "server/routes/instance/httpapi/groups/session.ts",
    // Line-pinned, so any edit ABOVE this reference in that file moves it and fails K106. Gate 6's
    // §12.6 typed-500 declaration on the `abort` endpoint did exactly that, 435 -> 438; target route
    // structure plus the restored multi-line abort description places the same descriptor at 434.
    line: 434,
    evidence:
      'HTTP route descriptor, not the Session service method: `HttpApiEndpoint.patch("updatePart", SessionPaths.updatePart, {...})`. `SessionPaths` is a route-path constant object; the endpoint it declares is handled by `handlers/session.ts::updatePart`, which IS registered below and carries the mutation lease.',
  },
]

export const REGISTRY: readonly Entry[] = [
  {
    file: "cli/cmd/debug/agent.handler.ts",
    symbol: "createToolContext",
    claims: [
      {
        authority: "out_of_scope",
        evidence:
          'Debug-only CLI surface. Registered at `cli/cmd/debug/index.ts:19-32` as `command: "debug"`, reached only via `src/index.ts` -> `DebugCommand` -> `AgentCommand`. It creates its OWN session first (`agent.handler.ts:130`, `sessionSvc.create({ title: `Debug tool run ...` })`) and writes the bootstrap Assistant to that new id, so it neither joins nor mutates a conversational session. Not reachable from the TUI/server execution loop.',
      },
    ],
  },
  {
    file: "server/routes/instance/httpapi/handlers/session.ts",
    symbol: "updatePart",
    claims: [
      {
        authority: "post_fence_reject",
        evidence:
          "Reject-on-fence, now INHERITED rather than local. After exact-coordinate validation the handler calls `session.replacePart(payload)` (`handlers/session.ts:493-505`) and the lease lives in that lower service, so this route is one caller of a guarded operation instead of the only guarded path. The handler still terminates the refusal with `Effect.die` because §12.6 declares this endpoint's typed 500 for `abort` alone and widening its declared errors is Gate 6's call. The coordinate validation deliberately stays AHEAD of the call: it is a read-only precondition, so a malformed request keeps its exact BadRequest rather than becoming a mutation refusal.",
      },
    ],
  },
  {
    file: "session/session.ts",
    symbol: "replacePart",
    claims: [
      {
        authority: "post_fence_reject",
        evidence:
          'The seam K52 names — "reject at the authoritative lower/wrapper seam; UI/direct core-call bypass cannot evade". `replacePart` (`session.ts:773-778`) wraps the shared publication at `:777` in `SessionMutation.leased(... kind: "replace_part")`, and `closure/mutation.ts:108-118` refuses before the body is entered. Because the guard sits on the Session service rather than on the HTTP handler, a direct domain call is refused too — `closure-update-authority.test.ts` drives exactly that call with no handler above it, and asserts the ledger shows `reserve` with no `activate`, which is what proves the body was never entered rather than entered and rolled back.',
      },
    ],
  },
  {
    file: "session/compaction.ts",
    symbol: "create",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Writes the compaction-trigger User Message (`:588`) and the scheduling compaction Part (`:596`). Both production entries are admitted: `prompt.ts:1390` and `:1618-1624` run beneath the `ensureRunning` admission at `run-state.ts:137-145`, and `handlers/session.ts` reaches it through `summarizeAdmitted`, which the handler enters via `SessionAdmission.admitted` before any cleanup or compaction mutation.",
      },
    ],
    uncertain:
      "`create` is service-exposed and enforces no admission locally, so the classification rests on an exhaustive caller-graph review rather than a structural guarantee. A future direct caller would be admitted-free without this inventory noticing, because K106 keys on callers of updateMessage/updatePart, not on callers of `create`.",
    resolveBy: "K108",
  },
  {
    file: "session/compaction.ts",
    symbol: "processCompaction",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Creates and terminalizes the compaction Assistant, replaces the existing compaction Part's `tail_start_id`, copies replay Parts, and creates the synthetic continuation (`:435,449,479,484,493,510,541,554`). The product entry is `compaction.process` at `prompt.ts:1373-1379`, which runs through `state.ensureRunning` at `prompt.ts:1647` and therefore inside `SessionAdmission.admitted` (`run-state.ts:137-145`). The `tail_start_id` write at `:484` is a genuine persisted replacement, so the inherited lease is load-bearing rather than incidental.",
      },
    ],
  },
  {
    file: "session/compaction.ts",
    symbol: "prune",
    claims: [
      {
        authority: "post_fence_reject",
        evidence:
          'Already implemented as reject-on-fence, and genuinely destructive despite appearances. `:262-278,305-309` stamp `part.state.time.compacted` and rewrite each Part; `message-v2.ts:340-343` then renders that marker as "[Old tool result content cleared]" with an empty attachment list, so the stored output becomes model-invisible — a persisted replacement, not a metadata touch. The whole batch runs under `SessionMutation.leased(... kind: "replace_part")` at `:300-313`, and `closure/mutation.ts:108-118` refuses before the body.',
      },
    ],
    uncertain:
      "The fence refusal is converted to a log at `compaction.ts:331-337` and the caller is detached (`prompt.ts:1636`, `Effect.ignore, Effect.forkIn(scope)`). That is sound only while pruning stays best-effort; if pruning ever becomes required for correctness, a swallowed refusal becomes silent divergence.",
    resolveBy: "K108",
  },
  {
    file: "session/processor.ts",
    symbol: "cleanup",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        lines: [544, 559, 565, 609],
        evidence:
          "The target processor finalizer has four ordinary generic writes: PatchPart (`processor.ts:544`), current text (`:559`), reasoning (`:565`), and Assistant completion (`:609`). Excluded Snapshot coverage settlement is absent. Installed as `Effect.ensuring(cleanup())` at `:689`, inside the admitted body — `admission.ts` retires the lease in ITS `ensuring`, which is outside the body, so body finalizers still run under a live lease. Pending/running ToolPart terminalization routes through `SessionToolPart.terminalizeExact` at `:591-605`, which carries `cancellation_owned_terminalization` under its own entry and is deliberately not attributed to these four generic writes.",
      },
    ],
  },
  {
    file: "session/processor.ts",
    symbol: "completeToolCall",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Replaces a running ToolPart in `processor.ts:446-470`, with the tracked write at `:457`. The in-loop path is called from `handleEvent` at `:697`; that handler is drained at `:1012` by `processor.process`, which the admitted run loop invokes at `prompt.ts:1943`.",
      },
      {
        authority: "bridged_context_admission",
        evidence:
          "The SECOND route, split out at Gate 4 because the leased label is false for it, reaches `completeToolCall` through `EffectBridge.run.promise` from the generic tool and MCP/resource paths at `session/tools.ts:132,219,302,384,486`. K107's bridge measurement is decisive: `bridge.ts:61` re-provides the captured Context while `:64-67` starts a NEW ROOT FIBER that is not a child of the admitted fiber and outlives `admitted`'s retirement `ensuring`. SAFETY IS THE STATUS GUARD, NOT THE CONTEXT: `processor.ts:455-456` fresh-reads through `readToolCall` and returns unless the authoritative row is still `running`, so a terminalized ToolPart cannot be resurrected. This is not a teardown handler; it is the tail of the tool's own execution, guarded by whether abort fired while it ran.",
      },
    ],
  },
  {
    file: "session/processor.ts",
    symbol: "ensureToolCall",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Creates or repairs the ToolPart row in `processor.ts:501-535`, with tracked writes at `:509` and `:521`. Its only production calls are the `handleEvent` branches at `:604,608,612,620`, inside the admitted stream drain; the binding is not exposed on the processor Handle.",
      },
    ],
  },
  {
    file: "session/processor.ts",
    symbol: "failToolCall",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          'Terminalizes a running ToolPart with `status: "error"` and settles its deferred in `processor.ts:472-489`, with the tracked write at `:475`. Its only production calls are the `tool-result` error branch at `:672` and the `tool-error` branch at `:702`, inside the admitted drain.',
      },
    ],
  },
  {
    file: "session/processor.ts",
    symbol: "finishReasoning",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Finalizes the reasoning Part in `processor.ts:491-499` and writes the extracted Part at `:498`. Its callers are the `reasoning-end` branch at `:597` and step-finish reasoning finalization at `:723-725`; the binding is not exported.",
      },
    ],
  },
  {
    file: "session/processor.ts",
    symbol: "handleEvent",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Writes streamed reasoning, step, patch, text and Assistant state throughout `processor.ts:563-837`; direct tracked writes occur at `:576,710,736,747,759,796,830`. It is invoked by the stream drain at `:1011-1018`, specifically `Stream.tap` at `:1012`. Production processor work is bound under the `SessionRunState.ensureRunning` admission at `run-state.ts:200-214`. This is the per-streaming-token writer, so the enclosing loop's single admission is the correct granularity — a per-write lease would be wrong.",
      },
    ],
  },
  {
    file: "session/processor.ts",
    symbol: "updateToolCall",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "`processor.ts:430-444` fresh-reads the current ToolPart and writes `session.updatePart(update(match.part))` at `:436`. The in-loop path is invoked by `handleEvent` at `:622-636`, inside the admitted drain. The writer itself carries only `if (!match) return undefined` — there is no status guard here, which is why the bridged claim below has to name the callback's guard rather than this one's.",
      },
      {
        authority: "bridged_context_admission",
        evidence:
          "The Handle-exposed path, split out at Gate 4 on the same K107 bridge measurement recorded on `completeToolCall`, is invoked by the tool metadata callback at `session/tools.ts:71-86` through `run.promise`. The context is re-provided onto a new root fiber that outlives `admitted`'s retirement, so a bridged write can land after its lease is settled. SAFETY IS THE CALLBACK'S STATUS GUARD at `tools.ts:74`: `if (!['running','pending'].includes(match.state.status)) return match` prevents overwriting a terminal state. The residual is bounded and known — a late callback can interleave its read with cleanup terminalization and issue a redundant write — which is why this is weaker than `completeToolCall`, whose guard sits on the authoritative fresh read in the writer itself.",
      },
    ],
  },
  {
    file: "session/prompt.ts",
    symbol: "createUserMessage",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Persists the User row and resolved Parts at `prompt.ts:1637-1638`. Every product entry is admitted: the Task-internal wrapper is at `:254-264`, the public prompt admission at `:1683-1691`, and command admission at `:2113-2117`. Each reaches `promptAdmitted`, which calls `createUserMessage` at `:1656`.",
      },
    ],
  },
  {
    file: "session/prompt.ts",
    symbol: "finalizeInterruptedAssistant",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Writes the interrupted Assistant in `prompt.ts:1869-1877`, constructing the aborted error at `:1871-1874` and persisting it at `:1876`. It is installed as an interrupt finalizer at `:1885` and `:2028`. This runs under a live lease because the admitted body is nested INSIDE `admitted`'s own retirement `ensuring` (`admission.ts`), so body finalizers complete before the lease retires.",
      },
    ],
    uncertain:
      "The classification depends on finalizer placement: moving either `Effect.onInterrupt` outside the admitted `runLoop` body would invalidate it, and nothing structurally prevents that.",
    resolveBy: "K108",
  },
  {
    file: "session/prompt.ts",
    symbol: "finish",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "The uninterruptible shell finalizer is at `prompt.ts:1059-1081`, with the Assistant completion write at `:1067` and running-to-completed ToolPart transition at `:1078`. It is awaited at `:1114` before `shellImpl` returns, while the `SessionRunState.startShell` admission at `run-state.ts:217-238` still spans the work.",
      },
    ],
  },
  {
    file: "session/prompt.ts",
    symbol: "handleSubtaskAdmitted",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        lines: [349, 364, 480, 483, 498, 523, 525],
        evidence:
          "Creates the subtask Assistant (`prompt.ts:349`) and running Task ToolPart (`:364`), then writes the normal terminal Assistant/ToolPart rows (`:480,483,498`) and optional synthetic continuation Message/Part (`:523,525`). The `handleSubtask` wrapper takes a FRESH internal `SessionAdmission.admitted(..., { reuseAmbient: false })` before calling `handleSubtaskAdmitted`, so these writes cannot inherit an ambient lease that predates a newly raised fence. Excluded Snapshot coverage helpers are absent from the target and contribute no writes here.",
      },
      {
        authority: "cancellation_owned_terminalization",
        lines: [446],
        evidence:
          "The `Effect.onInterrupt` callback calls `taskAbort.abort()` and finalizes the Assistant row at `prompt.ts:446`. Its ToolPart half routes through `SessionToolPart.terminalizeExact` in the same callback (`prompt.ts:447-460`), which carries `cancellation_owned_terminalization` under its own entry and performs the race-preserving check against a FRESH authoritative read rather than a caller-held Part. What remains directly attributed here is cancellation-owned because it runs only on the interrupt path and writes no generic ToolPart terminal state. Recorded as a distinct claim because collapsing it into the surrounding leased writes would erase the one authority story K107 needs from this file.",
      },
    ],
  },
  {
    file: "session/prompt.ts",
    symbol: "metadata",
    claims: [
      {
        authority: "post_fence_reject",
        evidence:
          "Replaces the Task ToolPart state through the callback at `prompt.ts:774-781`, whose tracked write is at `:776`. The ordinary immediate path invokes it at `tool/task.ts:604-607`. The admission-free delayed path stores it in `background.startExact` as `onPromote: Effect.all(...)` at `task.ts:1019-1058`, specifically `:1048-1054`. `BackgroundJob.promoteOn` extracts and executes the callback at `packages/core/src/background-job.ts:895-926`, with ignored callback execution at `:924`. The product HTTP entry remains `handlers/experimental.ts:158-170`, calling `background.promote` at `:169` with no `SessionAdmission.admitted` seam above it, so the delayed invocation is not proven to carry any AdmissionContext and must reject while fenced.",
      },
    ],
    uncertain:
      "Mixed authority in one binding: the immediate call from `handleSubtaskAdmitted` IS leased, only the stored promotion callback is not. K108 DELIBERATELY DID NOT ADD THE GUARD HERE, and the reason is structural rather than budgetary. (1) `background-job.ts:924` runs the callback as `result.onPromote.pipe(Effect.ignore)`, so a fenced rejection would be swallowed and could not satisfy §7.6's requirement that a post-fence mutation be \"rejected immediately through its existing domain/HTTP/SDK error path\" — the HTTP promote at `handlers/experimental.ts:158-170` would still answer success. (2) Decisively, `task.ts:1048-1054` composes `onPromote: Effect.all([ctx.metadata({...}), attach()])`. `Effect.all` is sequential and short-circuits, so a metadata guard that failed under a fence would SKIP `attach()` — a behaviour change to CP-021's attachment path, which Gate 3 is barred from touching and Gate 8 owns. A correct fix must therefore reorder or isolate the two effects, which is a CP-021 integration decision, not a mutation-lease decision. Promotion-time authority is already the Gate-4-keyed one-shot-transfer item (§7.3 row 15), so the guard belongs there and must be co-designed with Gate 8.",
    resolveBy: "Gate 4 + Gate 8",
  },
  {
    file: "session/prompt.ts",
    symbol: "runLoop",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Allocates and persists each new Assistant at `prompt.ts:1867`, then writes final structured-output, content-filter and structured-output-error state at `:1965,1979,1988`. The only execution handoff is `state.ensureRunning(..., runLoop(...))` at `prompt.ts:2057-2061`; `run-state.ts:200-214` admits and binds the Runner before executing the work.",
      },
    ],
  },
  {
    file: "session/prompt.ts",
    symbol: "shellImpl",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Persists the shell User Message and synthetic Part at `prompt.ts:1009,1018`, the Assistant and running shell ToolPart at `:1034,1049`, and each streamed-output update at `:1103`. `SessionPrompt.shell` hands `shellImpl` to `state.startShell` at `prompt.ts:2077-2084`; `SessionRunState.startShell` acquires and binds admission at `run-state.ts:217-238` before Runner setup. Completion writes at `prompt.ts:1067,1078` belong to the separately registered nested `finish` symbol. The per-chunk writer confirms the streaming-granularity rule: one enclosing shell admission spans every chunk write.",
      },
    ],
  },
  {
    file: "session/reminders.ts",
    symbol: "apply",
    claims: [
      {
        authority: "pre_fence_leased_execution",
        evidence:
          "Both branches persist a newly minted synthetic TextPart onto the current User Message (`:56-65`, `:76-87`). The sole production caller is `SessionReminders.apply(...)` inside `SessionPrompt.run` at `prompt.ts:1405-1409`, which executes under the `ensureRunning` admission at `run-state.ts:137-145`.",
      },
    ],
  },
  {
    file: "session/session.ts",
    symbol: "fork",
    claims: [
      {
        authority: "proven_non_destructive_update",
        evidence:
          "Read-only with respect to any FENCEABLE session. At `session/session.ts:825-865`, `fork` reads the source and mints the target first (`:827-835`), reads the source transcript (`:836`), allocates a fresh MessageID for every copied Message (`:840-848`), and overrides both `sessionID` and `id` before `updateMessage` (`:845-850`). Every copied Part receives a fresh PartID plus the fresh target Message/Session coordinates (`:852-858`); only the pre-existing compaction tail coordinate is remapped (`:859-861`) before `updatePart` at `:862`. Every write therefore lands on a session that did not exist when any fence was raised. It preserves reserved metadata bytes without granting presentation: a genuine closure payload remains bound to the source Session while the copied row is bound to the fresh target Session, so the complete-pair classifier cannot accept it.",
      },
    ],
    uncertain:
      "Rests on a newly created idle target remaining unfenceable for the duration of the copy. `createNext` publishes its Created event before copying, so if a fence could ever be raised on such a target this needs a target-side guard.",
    resolveBy: "K108",
  },
  {
    file: "session/summary.ts",
    symbol: "summarize",
    claims: [
      {
        authority: "proven_non_destructive_update",
        evidence:
          "Selects the exact requested User Message and performs one bounded field mutation — `target.info.summary = { ...target.info.summary, diffs: msgDiffs }` (`:124-131`) — changing no identity or content coordinate and creating, deleting or reordering nothing. Authority CANNOT be inherited admission: both production callers detach it, `prompt.ts:1493` and `processor.ts:539-544`, each `.pipe(Effect.ignore, Effect.forkIn(scope))`, so the parent lease may retire while this write is still in flight. The narrow write shape is the whole authority.",
      },
    ],
    uncertain:
      "Because execution is detached, the narrow shape is load-bearing rather than incidental. Widening `summarize` to touch identity or content, or letting a caller target a closure-record Message, would invalidate the classification with no lease to fall back on.",
    resolveBy: "K108",
  },
  {
    file: "session/closure/record.ts",
    symbol: "write",
    claims: [
      {
        authority: "exact_closure_capability",
        evidence:
          "CP-023 §11's closure record writer. `write` accepts only the coordinator-issued `pair.write` plus the exact `FrozenPair` resolved from the current generation (`record.ts:83-103,134-173`); it verifies both frozen logical byte strings before calling core's high-level `ClosureRecordService` at `:154-170`, publishes Message before Part, and never receives EventExact's opaque token. The real three-fact coordinator/driver path is exercised in `closure-driver.test.ts:828` and proves each permit returns only after exact row readback.",
      },
    ],
  },
  {
    file: "session/toolpart-closure.ts",
    symbol: "terminalizeExact",
    claims: [
      {
        authority: "cancellation_owned_terminalization",
        evidence:
          "The ORDINARY ToolPart terminalization, and Gate 7 reclassified it from `exact_closure_capability` on the audit's finding that the old label was false for its callers. Its two callers — `prompt.ts::handleSubtaskAdmitted`'s `onInterrupt` and `processor.ts::cleanup` — are finalizers running in the SAME fiber as the body they finalize, ending Parts that body created; cancellation of their own execution is what owns the write, which is §7.7's second authority verbatim. It requires no closure permit and must not: demanding one would make an ordinary interrupt depend on a canonical closure operation that does not exist on that path. Reach is still narrow — one `{session, message, part}` coordinate, a FRESH `getPart` rather than a caller-held Part, a write only while the authoritative read shows `pending`/`running`, `preserved` with no write on a race winner (I-11, K11, K12), and `unavailable` on a missing or non-tool row (K44) — and the terminal payload stays the caller's because `prompt.ts` and `processor.ts` write different documented bytes that `cli/cmd/run/subagent-data.ts:301` branches on. The granted surface is `Pick<Session.Interface, getPart | updatePart>`, so this carries neither an `AdmissionContext` nor a `MutationLease`. Read-then-conditional-write is safe from both callers precisely because of the same-fiber finalizer property; the cross-fiber case is `terminalizePermitted`'s and is post-proof.",
      },
    ],
  },
  {
    file: "session/toolpart-closure.ts",
    symbol: "terminalizePermitted",
    claims: [
      {
        authority: "exact_closure_capability",
        lines: [101],
        evidence:
          "§7.5's ToolPart capability, and the only caller is `session/closure/toolpart.ts:111`. Authority is a coordinate-exact single-use `SessionToolPartPermit.Permit`, derived at `session/closure/toolpart.ts:94` from an operation-scoped `Grant` that `coordinator.ts::runDriver` mints under the authority lock at `session/closure/coordinator.ts:968` and revokes when the run returns. Both are `unique symbol` brands whose authority lives in module-private WeakMaps, so an object literal, a structural copy, a JSON round-trip, or a token from another process is refused — §7.5's 'unforgeable in-process object/brand', not a copyable namespace. The function takes NO coordinate argument: it reads the Session/Message/Part triple and the single permitted `active_to_terminal` transition out of the permit, so one authority reaches exactly one row. An unrecognized permit is a DEFECT (`Effect.die`), on `replay-permit.ts`'s reasoning; the honest degraded answer lives upstream, where `closure/toolpart.ts` reports `unknown` if a permit cannot be issued. The write is deliberately NOT factored with `terminalizeExact`'s: K106 attributes each `updatePart` call to its enclosing symbol, so one shared writer would collapse both authorities into one entry. Cross-fiber safety is §8.4's ordering — the driver calls this only after the fixed point proves no affected Session has a busy Runner, active shell, or live job.",
      },
    ],
  },
  {
    file: "tool/plan.ts",
    symbol: "execute",
    claims: [
      {
        authority: "bridged_context_admission",
        evidence:
          "ONE path only, and it is bridged — unlike the two `processor.ts` siblings there is no in-loop caller to split off. After the Question continuation resolves it writes a new User Message and synthetic TextPart to `ctx.sessionID` (`:53-69`). Production invocation is always through `SessionTools` (`session/tools.ts:105-115`, `const result = yield* item.execute(args, ctx)`), whose bridge captures and re-provides the full Effect context (`effect/bridge.ts:54-65`); that context originates inside the `SessionAdmission.admitted` body at `run-state.ts:137-145` but is re-provided onto a new root fiber, making it a description of a lease rather than a hold on one. SAFETY IS NOT A STATUS GUARD HERE, which is precisely why the category names the admission mechanism rather than one guard: this writes only FRESHLY MINTED coordinates — `MessageID.ascending()` at `:54` and `PartID.ascending()` at `:63` — so it overwrites no existing row and cannot destroy a race winner. Its exposure also differs from `completeToolCall`: the writes happen while the Question continuation resolves rather than at abort time, so the enclosing loop is normally still live. A future product caller invoking this tool outside `SessionTools` would need its own admission; the debug CLI caller is separately excluded and supplies a fresh session.",
      },
    ],
  },
]

export const registryKey = (entry: { readonly file: string; readonly symbol: string }) =>
  `${entry.file}::${entry.symbol}`

/** Present so a taxonomy change cannot silently drop a category the test reports on. */
export const AUTHORITIES: readonly Authority[] = [
  "pre_fence_leased_execution",
  "cancellation_owned_terminalization",
  "exact_closure_capability",
  "proven_non_destructive_update",
  "post_fence_reject",
  "bridged_context_admission",
  "out_of_scope",
]

export type { Tracked }
