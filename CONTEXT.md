# OpenCode Session Runtime

OpenCode sessions preserve durable conversational history while assembling the runtime context an agent needs to act correctly in its current environment.

## Language

**System Context**:
The structured collection of contextual facts presented to the model as initial instructions and chronological updates.
_Avoid_: System prompt

**Context Source**:
One independently observed typed value within the **System Context**, represented by a stable key, JSON codec, infallible loader, pure baseline/update renderers, and an optional removal renderer for dynamic sources.
_Avoid_: Prompt fragment

**System Context Registry**:
The Location-scoped registry of ordered, scoped producers that contribute to the current **System Context**.

**Mid-Conversation System Message**:
A durable chronological instruction that tells the model the newly effective state of a changed **Context Source**.
_Avoid_: System update, system notification, raw text diff

**Context Epoch**:
The span during which one initially rendered **System Context** remains immutable, ending at compaction or another baseline-replacing transition.

**Baseline System Context**:
The full **System Context** rendered at the start of a **Context Epoch**.
_Avoid_: Live system prompt

**Context Snapshot**:
The overwriteable model-hidden JSON state used to compare each **Context Source** with the value last admitted to a provider turn.

**Unavailable Context**:
An expected temporary inability to observe a **Context Source** value; the runtime retains its prior effective state and emits no update, or omits it until first successfully loaded.

**Safe Provider-Turn Boundary**:
The point immediately before a provider call, after durable input promotion and any required tool settlement, where context changes may be admitted chronologically.

## Relationships

- A **System Context** is an opaque carrier composed from zero or more **Context Sources**.
- The **System Context Registry** uses stable-keyed scoped contributions to assemble the current **System Context**; contributor removal naturally removes its sources at the next **Safe Provider-Turn Boundary**.
- A changed **Context Source** may produce one **Mid-Conversation System Message** containing its newly effective state.
- A **Mid-Conversation System Message** persists the exact combined rendered text sent to the model.
- The current **Context Snapshot** advances atomically with the corresponding durable **Mid-Conversation System Message**.
- A **Context Snapshot** stores one codec-encoded JSON value and, for removable dynamic sources, a pre-rendered removal message per stable **Context Source** key.
- Changes from multiple **Context Sources** admitted at one safe boundary combine into one **Mid-Conversation System Message**.
- Context changes are sampled and admitted lazily at a **Safe Provider-Turn Boundary**, never pushed asynchronously when their source changes.
- At a **Safe Provider-Turn Boundary**, newly promoted user input or settled tool results precede any combined **Mid-Conversation System Message**.
- The first provider turn renders the latest complete **Baseline System Context** and initializes its **Context Snapshot** without emitting a redundant **Mid-Conversation System Message**; unavailable initial context blocks the turn instead of persisting an incomplete baseline.
- Initial **System Context** preparation precedes the first durable input promotion so an unavailable baseline leaves that input pending and retryable; ordinary reconciliation remains after promotion.
- Compaction starts a new **Context Epoch** with a freshly rendered **Baseline System Context** and **Context Snapshot**; prior **Mid-Conversation System Messages** remain durable audit history but leave projected model history.
- A newly registered core or plugin-defined **Context Source** absent from the current snapshot emits its baseline rendering once at the next **Safe Provider-Turn Boundary**.
- **Context Source** keys are stable and namespaced; duplicate keys fail composition. `SystemContext.combine(...)` preserves caller order; the **System Context Registry** evaluates producers concurrently and combines them in stable contribution-key order so rendered context remains deterministic.
- Each **Context Source** loader returns one coherent typed value. `SystemContext.make(...)` hides that value type so differently typed sources compose uniformly. Its codec compares and stores that value; its pure renderers produce model-visible baseline, update, and removal text only when needed.
- `SystemContext.initialize(...)` observes a composed **System Context** once and produces a fresh **Baseline System Context** with its **Context Snapshot**.
- `SystemContext.reconcile(...)` observes a composed **System Context** once and returns exactly one next action: unchanged, updated, replacement ready, or replacement blocked.
- `SystemContext.replace(...)` represents an explicit baseline-replacing transition such as compaction or model/provider switch; it either produces a fresh generation or reports that replacement is blocked by unavailable admitted context.
- Context Epoch preparation retries until stable after optimistic revision mismatches so concurrent replacement requests cannot terminate an otherwise valid safe-boundary run.
- **Unavailable Context** uses stale-while-revalidate semantics and is distinct from a successfully loaded absence, which may emit removal text.
- Ordinary **Context Source** loaders return values directly; loaders that intentionally use stale-while-revalidate may explicitly return **Unavailable Context**.
- Nested project instruction discovery after successful reads remains a follow-up; when implemented, discovered instructions must be admitted durably at the next **Safe Provider-Turn Boundary**.
- Location-scoped services naturally re-resolve effective context when a moved session next runs in its destination location.
- Moving a Session clears its active **Context Epoch**, so the destination must initialize a complete baseline before another prompt can promote.
- Context Epoch initialization is fenced against the authoritative Session Location, so an old-Location runner cannot recreate source context after a concurrent move.
- Instruction discovery, source identity, persistence, and file loading belong to the instruction service; the **System Context** abstraction only composes effectful producers and renders loaded values.
- The first instruction-service slice observes global and upward project `AGENTS.md` files as one ordered aggregate **Context Source** at each **Safe Provider-Turn Boundary**.
- Built-in and instruction context producers register through the **System Context Registry** with stable contribution keys. Plugin-defined context registration and hot-reload lifecycle remain a follow-up built on the same scoped registry seam.
- Context source changes never wake idle sessions; the next naturally scheduled **Safe Provider-Turn Boundary** loads and compares current values lazily.
- Once admitted, a **Mid-Conversation System Message** remains durable even if the following provider attempt fails and is replayed unchanged on retry.
- **Mid-Conversation System Messages** remain durable Session-message history; normal user-facing transcript surfaces may hide them.
- The date **Context Source** initially preserves host-local calendar-date behavior; a configured user timezone may replace that default later.
- A **Context Epoch** begins with one immutable **Baseline System Context**.
- A **Baseline System Context** is stored durably and reused verbatim across process restarts within its **Context Epoch**.
- A **Baseline System Context** durably preserves the exact joined text used for the active provider-cache prefix.
- Compaction or a model/provider switch starts a new **Context Epoch** because the baseline can be replaced without preserving the prior provider cache.
- A model/provider switch always starts a new **Context Epoch** while preserving chronological conversation history.
- A **Mid-Conversation System Message** lowers to the provider's native chronological instruction role when supported and to a wrapped chronological fallback otherwise.
- When the effective aggregate instruction set changes, its **Mid-Conversation System Message** includes the complete current ordered set and supersedes the prior aggregate value; when no ambient instructions remain, the message states that previously loaded instructions no longer apply.
- Ambient project instruction discovery honors `OPENCODE_DISABLE_PROJECT_CONFIG`; global instructions remain eligible.

## Example dialogue

> **Dev:** "The date changed while the session was active. Should the **Mid-Conversation System Message** say what the old date was?"
> **Domain expert:** "No. Emit the newly effective date so the agent can act on the current **System Context**."

## Flagged ambiguities

- Legacy `experimental.chat.system.transform` can mutate the assembled baseline system prompt arbitrarily, but V2 plugins do not yet expose an equivalent hook. Decide separately whether to port it, replace dynamic uses with plugin-defined **Context Sources**, or narrow its semantics.
