# Make running opencode instances visible to each other and to the human

## Why

Nothing watches the Agents. The system has good provider telemetry and zero client
telemetry, and the gap is not theoretical — it cost 18 hours on 2026-07-25.

Session `ses_0691e2d30ffe1mwU1XPH5gr2mQ` sat wedged for 18h48m on a half-open socket.
Throughout, every health signal was green: z4 reported `in_flight: 0, busy: false`
because z4 _was_ fine — it had finished and moved on. The provider was healthy; the
client was dead. skein's `get_providers_status` polls providers, so it could not have
caught this, and did not.

Meanwhile four opencode processes were running concurrently on one machine across three
different projects, sharing one 17.6 GB SQLite file, and the human could not answer basic
questions about their own Agents: which instances are running, what is each working on, is
any of them stuck, which one holds the session I care about. Answering it required `ps`,
`lsof`, and log archaeology.

Two distinct problems fall out of that:

**For the human** — there is no single view of running work, and no way to intervene
except finding the right terminal. Autonomy without observability is what turns one
wedged turn into an 18-hour hang, and a `/loop` workload multiplies that by N.

**For agents** — instances cannot see each other at all. Two instances will happily place
subagents on the same one-slot provider, start conflicting work in the same repo, or
duplicate a task, because neither knows the other exists.

Discovery already half-exists: `local/mdns.ts` advertises and finds **llama-swap
providers** over Bonjour. It does not advertise opencode instances. The transport is
built; nothing is announced on it.

## What Changes

### 1. Instances announce themselves

Each opencode server advertises over the existing mDNS layer: instance id, host, pid,
API base URL, version, and the directories it has sessions open in. Peers and skein can
discover the mesh without configuration.

### 2. Instances publish what they are doing

An instance exposes a presence record per active session: session id, directory, agent,
model, current status (`idle`, `busy`, `awaiting-permission`, `cancelling`, `stalled`),
iteration count if it is a loop, and time since last token or tool event.

`awaiting-permission` matters disproportionately. Today a session blocked on a permission
prompt is indistinguishable from a working one unless the human is looking at that
terminal, so agents silently wait on a human who does not know they are waiting.

### 3. Wedge detection

An instance that has had a turn in flight with no token, tool event, or state change for
longer than a threshold marks that session `stalled` in its own presence record — and,
critically, keeps publishing. A wedged session must announce that it is wedged. This is
the specific signal that would have surfaced the 18-hour hang within minutes.

Presence records carry a heartbeat. A record whose heartbeat stops is reported as
`unreachable` rather than silently disappearing, so a crashed instance is distinguishable
from one that exited cleanly.

### 4. One view, and the ability to act on it

A `/agents` command lists every discovered instance and session with status and age, and
supports cancelling or pausing a session on another instance through that instance's
existing HTTP API.

This is the payoff for the human: the answer to "what is everything doing right now" is
one command, and the response to a wedged session is one keystroke rather than `ps` and
`kill -9`.

### 5. Skein integration contract

The presence payload is the opencode-side half of Skein's Agents read model. It is
metadata-only and includes an explicit owner (`opencode-skein`), instance and
session identifiers, optional loop identity/iteration, project, provider/model,
normalized status, event and heartbeat timestamps, and control capabilities.
Skein aggregates this with native Go Agent presence. opencode-skein remains the
authority for its sessions: a normal prompt interrupts the loop, `/btw` is a
non-history side channel that does not interrupt it, and pause/resume/cancel are
forwarded only when advertised as supported.

### 6. Supervisor-facing experience

The intended consumer is a single Supervisor conversation, not a collection of
human-managed chat windows. The Supervisor reads the Agents roster and can
delegate work to an existing session or request a new Agent when presence and
capacity allow it. The presence API therefore needs enough structured metadata
to answer which Agent owns a task, which project/repository it is working in,
whether it is available, and which controls are supported. Session transcripts
remain private to the owning Agent; the Supervisor receives progress and result
events rather than scraping conversation content.

## Capabilities

### New Capabilities

- `agent-presence`: discovery of opencode instances, per-session status publication with
  heartbeat and wedge detection, and a cross-instance view with basic control.

## Non-Goals

- **No new transport.** This uses the existing mDNS discovery and the existing per-instance
  HTTP API. A push bus is `agent-coordination-bus`, and it is deliberately gated behind
  this change proving the data model first.
- No Agent-to-Agent messaging or negotiation. Publishing state is not conversation.
- No claiming or mutual exclusion — knowing an Agent exists is not coordinating with it; see
  `provider-slot-leases`.
- No WAN or cross-subnet discovery. mDNS scope only; remote hosts join via explicit config.
- Not a replacement for Skein's Agents view or Supervisor delegation. This adds the opencode-side half Skein
  structurally cannot see.

## Impact

- New: presence service in `packages/opencode/src/local/`, instance advertisement in
  `local/mdns.ts`, presence endpoints on the instance HTTP API, `/agents` TUI command.
- Presence is derived from state the session layer already tracks (`SessionStatus`), so
  the cost is publication, not new bookkeeping.
- Security: presence exposes directory paths and session titles on the local network.
  Advertisement must be disableable, and must be off by default on untrusted networks.

## Addendum (2026-09-05)

Phases 1-2 shipped; Phases 3-4 (wedge/heartbeat detection, the `/agents` view, Supervisor read
path) did not. That gap turned out to matter beyond observability: `/backlog`'s fan-out nudge and
local placement both consume presence today, with no liveness signal to filter on, which is the
most likely root cause of reports that the "free agent" list `/backlog` suggests is frequently
wrong (stale, busy, or unreachable entries presented as available). See Phase 6, added below, and
`subagent-notification-reliability` for the related delegate-and-idle investigation.
