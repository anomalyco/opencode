# OpenCode Session Runtime

OpenCode sessions preserve durable conversational history while assembling the runtime context an agent needs to act correctly in its current environment.

## Language

**System Context**:
The structured collection of contextual facts presented to the model as initial instructions and chronological updates.
_Avoid_: System prompt

**Context Component**:
One independently loaded fact within the **System Context**, represented by a stable key and one effectfully loaded baseline/update rendering.
_Avoid_: Prompt fragment

**Mid-Conversation System Message**:
A durable chronological instruction that tells the model the newly effective state of a changed **Context Component**.
_Avoid_: System update, system notification, raw text diff

**Context Epoch**:
The span during which one initially rendered **System Context** remains immutable, ending at compaction or another baseline-replacing transition.

**Baseline System Context**:
The full **System Context** rendered at the start of a **Context Epoch**.
_Avoid_: Live system prompt

**Context Checkpoint**:
The durable model-hidden comparison state used to detect which **Context Components** changed since context was last admitted to a provider turn.

**Unavailable Context**:
An expected temporary inability to load a **Context Component** value; the runtime retains its prior effective state and emits no update, or omits it until first successfully loaded.

**Safe Provider-Turn Boundary**:
The point immediately before a provider call, after durable input promotion and any required tool settlement, where context changes may be admitted chronologically.

## Relationships

- A **System Context** contains one or more **Context Components**.
- A changed **Context Component** may produce one **Mid-Conversation System Message** containing its newly effective state.
- A **Mid-Conversation System Message** persists its originating **Context Component** key and the exact rendered text sent to the model.
- A **Context Checkpoint** advances atomically with the corresponding durable **Mid-Conversation System Message**.
- A **Context Checkpoint** stores one rendered-content hash per stable **Context Component** key so core and plugin-defined components can evolve independently.
- Changes from multiple **Context Components** admitted at one safe boundary combine into one **Mid-Conversation System Message**.
- Context changes are sampled and admitted lazily at a **Safe Provider-Turn Boundary**, never pushed asynchronously when their source changes.
- At a **Safe Provider-Turn Boundary**, newly promoted user input or settled tool results precede any combined **Mid-Conversation System Message**.
- The first provider turn renders the latest **Baseline System Context** and initializes its **Context Checkpoint** without emitting a redundant **Mid-Conversation System Message**.
- Compaction starts a new **Context Epoch** with a freshly rendered **Baseline System Context** and **Context Checkpoint**; prior **Mid-Conversation System Messages** remain durable audit history but leave projected model history.
- A **Context Checkpoint** is an evolvable component map; a newly registered core or plugin-defined **Context Component** absent from an existing checkpoint emits its current state once at the next **Safe Provider-Turn Boundary**.
- **Context Component** keys are stable and namespaced; duplicate keys fail assembly. Built-in components preserve declaration order and plugin-defined components append in lexicographic key order so rendered context is deterministic.
- Each **Context Component** loader returns its model-visible baseline string and absolute current-state update string from one coherent sample; the update string is hashed for change detection.
- **Unavailable Context** uses stale-while-revalidate semantics and is distinct from a successfully loaded absence, which may emit removal text.
- Ordinary **Context Component** loaders return values directly; loaders that intentionally use stale-while-revalidate may explicitly return **Unavailable Context**.
- Nested project instruction files discovered while reading join the effective instructions returned by the instruction service and are admitted durably at the next **Safe Provider-Turn Boundary**.
- A discovered nested project instruction remains active for the session while it stays in the same location and is folded into later **Baseline System Contexts** after compaction.
- Location-scoped services naturally re-resolve effective context when a moved session next runs in its destination location.
- Instruction discovery, source identity, persistence, and file loading belong to the instruction service; the **System Context** abstraction only composes effectful producers and renders loaded values.
- Plugin-defined **Context Components** register through a scoped replayable registry so plugin hot reload adds and removes components predictably.
- Context source changes never wake idle sessions; the next naturally scheduled **Safe Provider-Turn Boundary** loads and compares current values lazily.
- Once admitted, a **Mid-Conversation System Message** remains durable even if the following provider attempt fails and is replayed unchanged on retry.
- **Mid-Conversation System Messages** remain durable model-projection history but are hidden from normal user-facing transcript surfaces.
- The date **Context Component** initially preserves host-local calendar-date behavior; a configured user timezone may replace that default later.
- A **Context Epoch** begins with one immutable **Baseline System Context**.
- A **Baseline System Context** is stored durably and reused verbatim across process restarts within its **Context Epoch**.
- A **Baseline System Context** durably preserves deterministic keyed top-level component strings rather than eagerly joining all text; request assembly lowers them into canonical LLM system parts.
- Compaction or a model/provider switch starts a new **Context Epoch** because the baseline can be replaced without preserving the prior provider cache.
- A model/provider switch always starts a new **Context Epoch** while preserving chronological conversation history.
- A **Mid-Conversation System Message** lowers to the provider's native chronological instruction role when supported and to a wrapped chronological fallback otherwise.
- When an effective instruction file changes, its **Mid-Conversation System Message** includes the complete current contents and supersedes the prior version from that source; when it is removed, the message states that it no longer applies.

## Example dialogue

> **Dev:** "The date changed while the session was active. Should the **Mid-Conversation System Message** say what the old date was?"
> **Domain expert:** "No. Emit the newly effective date so the agent can act on the current **System Context**."

## Flagged ambiguities

- Legacy `experimental.chat.system.transform` can mutate the assembled baseline system prompt arbitrarily, but V2 plugins do not yet expose an equivalent hook. Decide separately whether to port it, replace dynamic uses with plugin-defined **Context Components**, or narrow its semantics.
- A location change likely starts a new **Context Epoch** so location-dependent instructions and discovery can be rebuilt cleanly, but implementation should verify whether an append-only update is sufficient and meaningfully preserves cache.
