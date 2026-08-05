# Design: workspace-queue

## D1 — Schedule existing runs, do not build a second engine

The per-repo queue already owns everything hard: gates, disk-derived completion,
completion-claim verification, quarantine, the systemic-failure guard, the authority
ceiling, the credential-less shell. None of that is repo-count dependent.

So the driver's entire job is: which repos, in what order, how many at once, and what to
report. It creates ordinary queue runs through the same API a human uses and watches
`loop.updated`. If the driver dies, the per-repo runs it started are still ordinary runs —
visible in `/loop`, cancellable, resumable — rather than orphans of a bespoke system.

The temptation to teach `runQueue` about a list of directories should be resisted: it
would put a scheduling concern inside the function that must stay focused on one working
tree, and every gate decision would grow a "which repo" dimension.

## D2 — Per-repo config is the load-bearing problem

`Config` is instance-scoped (`InstanceState`), so `config.get()` inside the loop service
answers for the instance's directory. One server driving thirty repos therefore cannot
read thirty different `experimental.queue_gate` blocks by calling `config.get()`.

This is the one place the current design does not stretch, and it is not cosmetic: a
workspace run whose gate commands are wrong for twenty-nine of thirty repos will halt
twenty-nine times with "suspected misconfigured test gate" and accomplish nothing.

Two options were considered:

- **Per-repo instance.** Create each queue run inside the workspace/instance context for
  that repo, reusing the workspace routing the HTTP layer already has
  (`WorkspaceRoutingMiddleware` is already on the loop endpoints). Config then resolves
  naturally, because the instance *is* the repo.
- **Direct config read.** Have gate resolution read `<repo>/opencode.json` itself.

Prefer the first: it reuses an existing concept rather than adding a second, quieter way
for configuration to reach the queue, and it keeps `config.get()` meaning one thing. The
second is the fallback if per-instance creation proves impractical, and it must then be
explicit that gate options are the *only* config read that way.

Resolution order is repo config, then workspace defaults, then built-ins — so a workspace
can set a sane default (`bun run typecheck`) and a repo that differs overrides only what
differs.

## D3 — Concurrency is safe across repos, and bounded by capacity, not by a constant

Two changes in one repo cannot run at once: same working tree, same branch, same files.
Two *repos* have none of that in common, so the constraint does not apply — the
non-goal in `loop-spec-queue` was about trees, and it has been read as though it were
about scheduling.

The bound should be what the fleet can actually serve. A run's iterations are model turns;
starting eight repos against one busy provider produces eight queued requests and no extra
throughput, while the per-provider slot accounting already exists in
`LocalPlacement`/`capacity.ts`. So: concurrency = min(configured max, count of local
providers with free capacity), floor 1. With no local providers (a cloud-only setup) the
driver runs serial rather than guessing.

Rechecked between repo starts, not once at the beginning — capacity changes while a run
is going, which is the entire reason it is measured rather than configured.

## D4 — Order by staleness, not just priority

Within a repo, changes order by `priority` then `created`. Across repos the same instinct
applies but the failure mode differs: a workspace ordered only by priority will keep
picking the same favoured repo every run and starve the rest, because a repo with work
always has work.

Repo order is therefore: explicit list if given, then workspace-configured priority, then
**least-recently-attempted** (the newest `loop/<slug>` branch commit date, or absent that,
the oldest eligible change's `created`), then name. Least-recently-attempted is what stops
starvation without anyone maintaining a rota.

## D5 — Derived state, again

The driver stores nothing durable. Its position is recomputed from the same disk facts the
inner queue uses: a repo is done when it has no eligible change, quarantined when its
changes hold blockers. Restarting a workspace run re-derives which repos still need work
and skips the rest, exactly as restarting a repo run re-derives its cursor.

The consequence to accept deliberately: the driver cannot distinguish "this repo was
already drained before I started" from "I drained it". The report solves that by recording
what *this* run attempted, while the queue itself stays stateless.

## D6 — Failure isolation

A repo that halts must not stop the workspace. The inner queue already quarantines a stuck
change and continues; at the workspace level the same rule applies one level up — a repo
that halts (misconfigured gate, systemic guard, error) is recorded and the driver moves on.

The workspace-level systemic guard mirrors the per-repo one: if N consecutive repos halt
without a single gate passing anywhere in the run, stop and report a suspected
environmental cause. Three repos failing identically is a broken toolchain, not three
broken backlogs, and quarantining a workspace one repo at a time against a bad `bun`
install is exactly the failure the per-repo guard was added to prevent.

## D7 — Why this is not skein's job

`loop-spec-queue` says fleet dispatch stays skein's, and that still holds. The distinction
worth keeping is:

- **Workspace orchestration** (this): many repos, one machine, one filesystem, one
  opencode server that can see inside every session it starts.
- **Fleet orchestration** (skein): many machines, many checkouts, no shared filesystem,
  coordination over the network.

The reason skein could not do this well is the reason stated when the queue was built: it
drove opencode from outside and could not tell a wedged stream from a slow one, cancel an
in-flight turn, or reuse a session's permission profile. A workspace driver needs all
three, so it belongs where they exist. When skein later dispatches across hosts, the unit
it dispatches is a workspace run — which is a better interface than thirty individual
repo runs.
