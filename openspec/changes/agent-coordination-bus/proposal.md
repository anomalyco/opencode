# Push-based coordination bus for instances and the human

**Status: speculative.** This change is deliberately gated behind
`fleet-instance-presence` and `provider-slot-leases`. It should not be built until those
have run long enough to show what the mesh actually needs. The analysis below argues that
most of the value people expect from a message bus is obtainable without one — and
identifies the specific part that is not.

## Why

Three things the polling design in `fleet-instance-presence` genuinely cannot do well:

**1. Crash detection.** Polling infers death from silence, and silence is ambiguous — slow,
busy, network-blipped, and dead look identical until a timeout expires. MQTT's Last Will
and Testament makes a dying node's departure an explicit, immediate, broker-published
event. For a fleet whose defining recent failure was an 18-hour undetected hang, this is
the single strongest argument for a broker.

**2. Fan-out cost.** Presence over polling is O(N²) — every instance probing every other.
At five hosts this is free; at twenty it is not, and the design intent is clearly to grow.

**3. Shared human decisions.** Today, if four agents each need a permission decision, the
human context-switches into four terminals and answers four times. A bus lets a waiting
agent publish a question, lets the human answer once, and lets every agent blocked on the
same question consume that answer. **This is the only item on the list that improves human
collaboration rather than machine coordination, and it is the most interesting one.**

Nothing else on the wish list needs a broker. Discovery is solved by mDNS. Capacity is
solved by reading the right field. Mutual exclusion must not use pub/sub at all.

## What this must not become

**A bus is not a claim registry.** MQTT is at-least-once broadcast with no atomic
compare-and-set. Two nodes publishing `claim z4` in the same millisecond both believe they
won. Claims belong in `provider-slot-leases`, which is built on stores that can actually
say no.

**A bus is not a chat room for agents.** This is the failure mode worth naming explicitly,
because it is the one the "nodes become a brain together" framing walks directly into.

When LLM agents broadcast free-form reasoning to each other, agent A's speculation becomes
agent B's premise. B treats it as established, builds on it, and republishes. The group
converges on a confident, mutually-reinforced conclusion that no single agent had evidence
for — and because several agents now agree, it reads as corroboration. This is strictly
worse than one agent being wrong alone, because the wrongness arrives pre-validated.

Multi-agent architectures that work share **artifacts and verdicts**, not conversation, and
they have an arbiter. Map-reduce over independent workers, adversarial verification,
judge panels — all of these constrain what may be exchanged and who decides.

So the bus carries **structured, verifiable facts with a stated source**: "session X is
stalled", "I hold lease L on z4 until T", "test suite S failed, exit 1, output attached".
It does not carry "I think we should refactor the parser". A node may publish what it
observed and what it has claimed. It may not publish what it believes.

## What Changes

### 1. Presence and lease state mirrored to a broker

The records defined by `fleet-instance-presence` and `provider-slot-leases` are published
as retained messages, so a joining node gets current fleet state immediately rather than
waiting out a poll cycle. The broker is a **cache and notification channel, never the
source of truth** — the owning instance and the lease store remain authoritative, and a
broker outage degrades the mesh to polling rather than breaking it.

### 2. Last Will and Testament for liveness

Each instance registers an LWT marking its sessions `unreachable`. Death becomes an event
instead of an inference.

### 3. The human as a node

A blocked agent publishes a decision request. Any connected human client — TUI, or
anything else subscribing — can answer. The answer fans out to every agent blocked on the
same decision.

Requirements that make this safe rather than alarming: a decision request names its
session and its exact question; an answer is attributable to a specific human client; and
an agent may only act on an answer to a question it actually asked. An unanswered request
must block, never default.

### 4. Strict message taxonomy

Every message declares a type from a closed set: presence, lease, decision-request,
decision-answer, artifact-result. Free-form text is not a type. This is a structural
constraint, not a convention — an unrecognised type is dropped.

## Capabilities

### New Capabilities
- `coordination-bus`: optional push transport for presence, leases, and human decisions,
  with a closed message taxonomy and no authority over state.

## Dependencies

- `fleet-instance-presence` — defines the records this transports. Building the transport
  before the data model is the wrong order.
- `provider-slot-leases` — claims must already have a real home before anything broadcasts
  them.

## Infrastructure

A broker already exists: **`hlab-mosquitto`, LXC on proxmox, `192.168.1.131:1883`**,
verified reachable 2026-07-26. This removes the main argument against — there is nothing
to deploy, and it is already part of a homelab that is monitored and restarted like
everything else there.

Two facts about it shape the design:

- **Plain MQTT only.** Port 8883 (TLS) and 9001 (websockets) are closed; only 1883
  answers. Presence metadata includes directory paths and session titles, and would cross
  the LAN unencrypted and — depending on broker config — unauthenticated. Either the
  bus carries a reduced record on this broker, or TLS and credentials are added before it
  carries anything identifying. **This must be settled before the first publish, not
  after.**
- **It is shared with home automation.** A second MQTT user (Home Assistant has its own
  broker, and this one serves the homelab) means topic namespacing is a correctness
  concern, not tidiness: everything here lives under a dedicated prefix, and the client
  subscribes to nothing outside it.

## Open questions to resolve before building

- Is the decision-fan-out worth building on its own? If polling presence proves adequate,
  that feature could be served by the existing per-instance HTTP API plus skein.
- Does skein's existing message layer already cover this? It has meetings and messaging;
  duplicating it in a second transport risks two half-working coordination systems, which
  is the exact pathology `retire-auto-reply` is deleting elsewhere in this repo.
- Does a shared broker's availability actually beat direct HTTP between instances? A
  broker outage takes out coordination for every node at once, where per-instance HTTP
  fails only for the instance that is down.

## Non-Goals

- Not making the bus authoritative for any state.
- Not making a broker required — every capability must degrade to polling.
- Not agent-to-agent free-form messaging, now or later.
- Not WAN federation.

## Impact

- New: optional MQTT client, message schemas, LWT registration, decision request/answer
  flow in the TUI.
- Operational: a broker to run and monitor. That cost is the main argument against, and it
  should be weighed only once presence has demonstrated the polling ceiling.
