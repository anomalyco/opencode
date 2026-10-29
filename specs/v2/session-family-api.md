# V2 Session Family API

Status: **Proposed.** Nothing here is implemented. Schema would own the public shapes, Protocol the operations, and Core the behavior.

On 18 October, `BURROW` (`ses_ed3383a35ffePYFL3RkZLiJkdl`) was a week-old root Session with 97 subagent children. Thirty-one of those children had run in git worktrees that were since deleted. When the TUI opened `BURROW`, it sent these requests before it could draw the subagents tab or decide whether to show a permission prompt:

| Request                                         | Count | Answers                                          |
| ----------------------------------------------- | ----: | ------------------------------------------------ |
| `GET /api/session/active`                       |     1 | Which Sessions are running (once per connection) |
| `GET /api/session/ses_ed33…`                    |     1 | The root                                         |
| `GET /api/session?parentID=ses_ed33…&limit=200` |     1 | Its children                                     |
| `GET /api/session/:member/permission`           |    98 | Pending permission requests, root and children   |
| `GET /api/session/:member/form`                 |    98 | Pending forms, root and children                 |

That is 199 requests. The 62 permission and form reads for children in deleted worktrees fail:

```
$ opencode api get /api/session/ses_eb17785e8ffeeEbZoOi15KxeAR/permission
{"_tag":"LocationNotFoundError","location":{"directory":"/home/simon/src/burrow-wt/tooltips"},"message":"Location not found: /home/simon/src/burrow-wt/tooltips"}
HTTP 404 Not Found
```

Failed reads are not cached, so they repeat whenever the TUI shows `BURROW` again. On 18 October the server logged three bursts of these 404s, 60, 60, and 59, at 16:23, 16:24, and 16:26 UTC, while a TUI moved between `BURROW` and its children. No child was created in that window.

The TUI is one of three clients that rebuild a family from these reads, and each one gets a different part of it wrong. This document asks what a client should have to request to show one Session family, and proposes an answer.

## What a family view needs

A _Session family_ is a root Session and all of its descendants. Most descendants are subagent Sessions, though `session.create` accepts a `parentID` from any client. Forks are roots, not descendants. A _family view_ renders a family as a unit: the TUI session route and its subagents tab, a session tab's busy and attention badges, the running marker in the open dialog, and the iOS app's subagent cards and Home list. Every family view needs the same three facts about every member:

1. its Session: title, agent, model, cost, `time.idle`, `outcome`, and so on;
2. whether it is running;
3. its _pending requests_: permission requests and forms waiting for the user.

## Where each fact comes from today

**Members.** `session.list?parentID=` returns direct children only, newest `time.updated` first, in pages. The page cursor is anchored on `time.updated`, which changes while children run, so a running child can move between pages while a client reads them and be skipped or repeated. The cursor also returns `next` on the last page: with `limit=200`, the 94 children `BURROW` had at the time came back with a `next` cursor.

Three clients build families on top of it, each its own way:

- The TUI and the web app share [`packages/client/src/solid/data.ts`](../../packages/client/src/solid/data.ts). `listChildren` pages direct children 200 at a time and stops on a short page.
- `mini` has its own discovery in [`stream-v2.subagent.ts`](../../packages/tui/src/mini/stream-v2.subagent.ts) that combines four sources: `metadata.sessionID` on `subagent` tool parts, `session.list` filtered by `parentID`, `/session/active`, and live events from unknown Sessions, whose ancestry it walks one `session.get` at a time. It keeps at most 100 children.
- The iOS app (`opencode-ios`, `OpenCodeClient+Family.swift`) walks the tree breadth-first with one `session.list?parentID=` per member, six at a time, and stops at 100 Sessions. Running Sessions beyond the cap are found by walking `GET /api/session/:id` up their parents, at most 24 lookups. `BURROW` has 103 children today, so the first page fills the cap.

All three merge a read into what they already hold and drop a member only on `session.deleted`. The event stream is, in its own words, "volatile by contract: a slow consumer overflows and fails the stream, and events during disconnection are missed". A child deleted while a client is disconnected therefore stays listed in all three until the client restarts.

**Running.** `GET /api/session/active` returns "foreground Session drains currently owned by this OpenCode process". The TUI and web app hydrate that snapshot on `server.connected`, overlay `session.execution.*` events that arrive during hydration, read every running Session the snapshot names that they have not loaded, apply later events directly, and read the Session again after every terminal event so that `time.idle` and `outcome` catch up. If the Session has not loaded yet, that read is skipped. A child that finishes while the first family read is in flight therefore keeps the `time.idle` and `outcome` from before it finished. The iOS app uses the same snapshot and events. A Session read carries none of this, so every view that shows a Session joins it against the snapshot and the event stream.

**Pending requests.** The TUI reads `session.permission.list` and `session.form.list` once per member, and both enter that member's Location before reading. If the directory is gone, the read fails with the 404 above. If the directory exists but its Location is not running, the read starts it. Since #59083, `session.form.list` returns `[]` when `Instance.live` reports the Session's Location as not live, but `live` is true for a Location that is still starting, so such a read still waits for the start and fails if the start fails. `session.permission.list` has no such check yet. One permission read for an idle Session in `~/.cache/tmp/opencode/storytest` logged `location services booted`, 11 `watcher started` lines, and 39 `watcher subscribe` lines, and then returned:

```
{"data":[]}
```

The other clients read pending requests per Location instead, which is worse in a different way. The iOS app reads `GET /api/permission/request` and `GET /api/form` for the selected Session's directory only, filters the results to the family, and repeats the pair every 12 seconds while the event stream is healthy. It allows 60 seconds per read because "a location-scoped read makes the server boot that location's service graph (including MCP processes) on first touch". A subagent working in another directory never appears: when one of `BURROW`'s worktree children asks for permission, the phone does not show it. The web app's permission auto-approval reads `GET /api/permission/request` for every distinct directory of every loaded Session, deleted worktrees included, and retries an incomplete sweep twice.

The empty result above is the important part. `Permission.Service` and `Form.Service` are Location-scoped and keep pending requests in memory. Requests are created by code running inside a started Location, so a Location that is not running cannot hold one. The read started a Location to learn something that was already known.

All three facts have the same shape of problem: the answer exists in one place on the Server, and every client assembles it from many reads. The rule this proposal follows is:

**A client should render a Session family from one read and keep it current from events.**

## Proposal

### 1. Status is part of `Session.Info`

Schema's `Session.Info` gains one field:

```ts
status: "idle" | "running"
```

`running` means `SessionExecution` owns a busy period for the Session in this process. That is what `session.execution.started` and the terminal execution events describe, and it is the set `/session/active` returns. It does not mean the Session is waiting on the user, which its pending requests say; or that it has queued input, which its inbox says; or that something else in its family is running, which the family read says.

The field belongs on `Session.Info` itself, not on a response shape that only Protocol knows about. There is one canonical Session contract: the generated Effect client types Session responses as `Session.Info`, and its `preserveEffect` wrapper rejects a response wider than that contract at compile time. `contract-identity.test.ts` asserts that `SessionGetOutput` is `Session.Info`. Plugins also read Sessions from Core's facade directly (`plugin/host.ts`), not over HTTP. So Core's Session facade attaches `status` wherever it returns a Session: `get`, `list`, `create`, `fork`, import, and the family read.

The shape without `status` gets its own canonical name, following the existing `Session.Revert.Persisted`:

```ts
Session.Persisted // every field Session.Info has today; identifier "Session.Persisted"
Session.Status // "idle" | "running"; no identifier, so generated clients inline it
Session.Info // Session.Persisted plus status; identifier "Session.Info"
```

`SessionStore` and `fromRow` return `Session.Persisted`, and Core functions that never read `status` take `Session.Persisted`, which every `Session.Info` satisfies. Session transfer uses it too: Protocol adds a `PublicSessionPersisted` beside `PublicSessionInfo`, and `SessionTransfer.Data.info` and the import payload use it, so exports written before this change still import. The only rename a client sees is the type of an export's `info`: the generated Promise client calls it `SessionPersisted` instead of `SessionInfo`, and the Effect client maps it to `Session.Persisted`. Every other Session response keeps the name `Session.Info`. `Session.Status` carries no identifier because `SessionStatus` already names the retry/busy/idle union of the ephemeral `session.status` event.

The facade takes its snapshot of the running set before it reads Session rows. A read can then never pair `idle` with a row from before the terminal commit. Clients also rely on one guarantee from the Server: a read never reports a state older than an execution event the Server has already published. Today that holds because nothing asynchronous runs between the coordinator publishing a terminal event and removing the Session from its set. A change that adds asynchronous work between the two must compute `status` from state cleared before publication.

`/session/active` stays, as the inventory form of the same state, and each entry gains `rootID`. Execution events carry only a `sessionID`, so today a client that sees `session.execution.started` for a child it has never loaded cannot tell which root to mark as busy. The iOS app walks `GET /api/session/:id` up the parents to find out; the TUI open dialog loads the child and resolves its root. Putting `rootID` on the durable execution events would repeat state derivable from Session history, which [`AGENTS.md`](../../AGENTS.md) rules out for durable events. `/session/active` is a read model and may carry it.

### 2. One read returns the whole family

```
GET /api/experimental/session/:sessionID/family
```

returns every Session in the tree that contains `sessionID`: the root first, then its descendants ordered by `time.created` and then `id`. Any member's ID returns the same family, so a client that opens a subagent first does not have to find the root. The Server builds the tree with one recursive query over `parent_id`, and every member's `status` comes from the same snapshot of the running set.

The endpoint starts experimental, as [`AGENTS.md`](../../AGENTS.md) requires of new endpoints: its OpenAPI identifier is `experimental.sessionFamily.get`, and the SDK exposes it as `client.experimental.sessionFamily.get`.

```jsonc
{
  "data": {
    "rootID": "ses_ed3383a35ffePYFL3RkZLiJkdl",
    "sessions": [
      { "id": "ses_ed3383a35ffePYFL3RkZLiJkdl", "title": "BURROW", "status": "running" /* … */ },
      {
        "id": "ses_ed318b5bcffehqibTcl8BoILYr",
        "parentID": "ses_ed3383a35ffePYFL3RkZLiJkdl",
        "title": "Research items and progression",
        "agent": "general",
        "status": "idle",
        "outcome": "succeeded",
        /* … */
      },
      // … every other child, oldest first
    ],
    "permissions": [],
    "forms": [],
  },
}
```

The read is complete by contract and not paginated. On 18 October the 97 children of `BURROW` encoded to 54,129 bytes. On 26 October the largest family in this database, `OpenTUI`, had 333 children, and they encoded to 181,507 bytes. If families ever need paging, it must be opt-in and the default response must stay complete, because family views sum cost and status over every member. Creation order never changes, so such a cursor would not skip or repeat members.

### 3. Pending requests are read only from running Locations

The `permissions` and `forms` arrays hold the family's pending requests. The Server groups members by canonical Location, lists the pending requests of each Location that has finished starting, and keeps those owned by a member. A Location that is still starting, failed to start, or never started contributes nothing. That is the correct answer, not a degraded one: it cannot hold a request.

The lookup must neither wait for nor fail on a Location that is still starting. `LocationServiceMap.contextEffectOption` does both: it joins a start that is in progress, and "an in-flight or cached failure fails with the same error as `get`", which `location-layer.test.ts` asserts. Used directly, one child whose deleted worktree happens to be starting would stall or fail the whole family read. `Instance.live`, added for forms in #59083, has the same problem in a milder form: it is `RcMap.has`, true for a Location that is still starting.

So a Location is _running_ when its start has finished and it has not been invalidated since, and `Instance.live` changes to mean exactly that. `buildLocationServiceMap` already records the moment: a build gets its `close` handle only when it succeeds, and invalidation or failure removes the build. The map exposes that as a check that never waits, and `Instance.live` uses it. The SDK's embedded instance map tracks the same state for its own `live`. A Location that is still starting reports not running, which is correct: no code inside it can have created a request yet, and any request created after the start finishes arrives as an event.

The per-Session reads follow the same rule. `session.form.list` already returns `[]` when `Instance.live` is false; with the tighter `live` it also stops waiting on starts. `session.permission.list` gets the same check, instead of starting the Location or failing with `LocationNotFoundError`. The other form routes keep `FormLocationMiddleware`, and so does the undocumented `"global"` path that MCP elicitations use.

The Location-scoped reads, `GET /api/permission/request` and `GET /api/form`, keep starting their Location, because their response describes the Location, project included, which needs it running. Clients that read Session-owned requests through them switch to the family read: the iOS app, which then sees subagents in every directory, and the web app's auto-approval. MCP forms that belong to no Session stay on `GET /api/form`.

### 4. Reads and events reconcile by newest observation

Reads and events travel on different connections and arrive in either order. So while a read is in flight, the client records every event that changes what the read returns. When the response arrives, the client applies it and then replays the recorded events on top. An event recorded during a read is newer than the read. This is the _newest observation_ rule, and it covers everything a family read returns:

- **Status.** `session.execution.started` sets `running`. A terminal execution event sets `idle`.
- **Session fields.** Every event that changes a Session patches it: usage, rename, move, agent and model selection, permissions, revert, viewed, and the terminal execution events. A terminal event other than a shutdown interruption also sets `time.idle = max(previous, created)` and, unless it is older than `time.idle`, `outcome`; `session.viewed` sets `time.viewed = max(previous, idle)`; and every event the projector stamps on `time.updated` raises it to the event's `created`. Replay applies an event a second time whenever the read already included it, so every fold must be idempotent. The projector's own `time.idle` formula adds 1 when two terminals share a millisecond, which is not idempotent, so the client omits that bump. The client then no longer reads the Session after every terminal event. An event for a Session the client has not loaded yet is recorded, not skipped.
- **Members.** A family read replaces the family's member list, minus Sessions deleted during the read, plus Sessions created during the read and local creations the Server has not acknowledged yet. Replacing is the only way to drop a member deleted while the client was disconnected, so the client also forgets the dropped member's Session and pending requests. A family read invalidated while in flight, by a disconnect or by deletion of the Session it was keyed by, applies nothing: its snapshot is older than the read that supersedes it.
- **Pending requests.** Session-owned requests are keyed by `(sessionID, requestID)`, and MCP forms by `(Location, formID)`. Callers may supply permission and form IDs, and pending requests are only unique within a Location.

Today's clients apply this rule in some places and not others. `session.pending.sync` and the TUI open dialog already record events during their reads, and the iOS app overlays execution events on its family and Home reads. But `permission.sync` and `form.sync` in [`data.ts`](../../packages/client/src/solid/data.ts) overwrite the stored list with the response, while the `permission.asked` and `form.created` handlers append. The permission service adds a request to its in-memory map and then publishes the event, so a read that runs just before the request is added misses it while the event still arrives. If that event reaches the client before the response, the response erases the request. The prompt and the attention badge disappear, any notification for the request has already gone out, and the Session waits for an answer nobody can give until the client reconnects. The window is a few milliseconds. Session reads have the same problem in a quieter form: they write whole Session objects, so a usage or move event that arrived during the read is overwritten.

### 5. `session.list` stops offering a page it does not have

`session.list` returns `cursor.next` only when another Session exists, by reading one row more than `limit`. A backward page reverses its rows, so the extra row must be dropped before the reversal. Families no longer page through `session.list` at all, but root lists still do.

## What a family view costs afterwards

| Client               | Today                                                                                                                                   | Afterwards                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| TUI opening `BURROW` | 199 requests; 62 failed on 18 October, 31 still fail since #59083                                                                       | `/session/active` once per connection, one family read |
| iOS app              | one list per member up to 100 Sessions, `/session/active`, up to 24 ancestor reads; pending requests for one directory every 12 seconds | one family read                                        |
| `mini`               | list walk, `/session/active`, two pending-request reads per child, failed ones retried forever                                          | one family read                                        |

Events then keep the view current:

| Event                                                                                                                                                      | Effect on the family view                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `session.created`                                                                                                                                          | Read the new Session; it joins the family once its parent is a member  |
| `session.deleted`                                                                                                                                          | Remove the member                                                      |
| `session.execution.started`                                                                                                                                | Set `status` to `running`                                              |
| `session.execution.succeeded`, `session.execution.failed`, `session.execution.interrupted`                                                                 | Set `status` to `idle`; unless shutdown, set `time.idle` and `outcome` |
| `session.viewed`                                                                                                                                           | Set `time.viewed`                                                      |
| `session.usage.updated`, `session.renamed`, `session.moved`, `session.agent.selected`, `session.model.selected`, `session.permissions`, `session.revert.*` | Patch the member                                                       |
| `permission.asked`, `permission.replied`                                                                                                                   | Add or remove a pending permission request                             |
| `form.created`, `form.replied`, `form.cancelled`                                                                                                           | Add or remove a pending form                                           |

A client must not discard a `session.created` event because the parent has not loaded yet: a subagent and its own child can be created back to back. A reconnect repeats the one read.

## Compatibility

`Session.Info.status` and the family endpoint are additive for existing clients. The TypeScript clients are regenerated from the assembled `HttpApi`. The reverse does not hold: the Effect client decodes responses, so a newer Effect client rejects Sessions from an older server, which send no `status`, as it would any new required field. The desktop browser pane is the one in-repo Effect client that can reach a server of another version. The Promise client used by the TUI and CLI does not decode responses. App and desktop exports, which assemble the transcript from `session.get`, drop `status` too. The iOS app decodes Sessions with hand-written Swift payloads, which ignore keys they do not know. Plugins receive `status` from Core's facade. Session export and import keep their status-less shape, and `rootID` on `/session/active` entries is a new field the iOS app already ignores alongside `type`.

Two behaviors change. `session.permission.list` returns `[]` instead of `LocationNotFoundError` for a Session whose directory is gone and no longer starts an idle Location, as `session.form.list` already does. Both stop waiting on a Location that is still starting. No current client relies on the old behavior. The TUI discards those failures, and the iOS app never calls these endpoints. `mini` retries each failed child on its own timer, backing off from 50 ms to a 2-second cap and never giving up, and every hydration, including each reconnect, reads pending requests for up to 100 children. By that code, a `mini` view of `BURROW` sends 31 failing permission reads every 2 seconds for as long as it stays open; before #59083 fixed forms it was 62. I have not run `mini` against `BURROW` to observe it.

## Alternatives

**Derive `status` from the execution claim.** The claim is durable, so `status` would survive restarts and be visible to any process reading the database. But [Session](./session.md) states that "durable execution events and claims are historical and recovery records, not proof that this process is still live". Shutdown preserves claims on purpose, and startup clears the claims of non-recoverable children without any terminal event. This alternative belongs with clustering, which has to define liveness anyway.

**Put `status` only on Protocol's response shape.** Core and Schema would not change. But the generated Effect client and the contract-identity test require the response to be exactly `Session.Info`, and plugins, which read Sessions from Core, would never see the field. Rejected.

**Keep `status` out of the Session and improve `/session/active`.** No public shape changes. But clients still join a snapshot, events, and Session reads to answer one question, and every family view still needs a second read.

**Add a `rootID` filter to `session.list`.** One endpoint instead of two. But `session.list` is the recent-Sessions collection: it orders by `time.updated`, anchors cursors on it, and accepts search, directory, project, and subpath filters that mean nothing inside one family. A family has a different natural order and no need for paging.

**Serve pending requests from a separate family endpoint.** The family read would stay a pure database query. But every family view needs both, so clients would make two reads and reconcile two snapshots against the same events.

**Order reads and events with a Server watermark.** Every public event would carry a sequence number, every read would return the watermark it was sampled at, and clients would apply only later events. That replaces the newest-observation rule with one exact comparison. But no shared sequence exists today: durable sequence numbers are per aggregate, permission and form events are not durable, and event IDs are allocated before commit. Every public read would need the field. Worth revisiting if more read models need the same guarantee.

**Open a family event stream that starts with a snapshot.** The Server would send the snapshot and then the family's events on one connection, which removes the race instead of repairing it. But the [event stream architecture](./event-stream-architecture.md) deliberately gives each client one shared feed that is encoded once, and a stream per open family works against that. Pending-request events are not replayable either. Not justified yet.

**Use a richer status vocabulary.** Values such as `waiting`, `queued`, `retrying`, or `compacting` would let one field describe more. But each would have to be reconciled against its own events, coupling independent state machines into one field. Clients derive waiting from pending requests and queued work from the inbox. Rejected.

**Count running members on root entries of `session.list`.** Root lists could light a busy family without loading it. But the count goes stale the moment a child starts or finishes, and execution events carry only the child's `sessionID`, so a client cannot update the right root without loading the child. `rootID` on `/session/active` entries answers the same question and stays current with the snapshot. Rejected in favor of `rootID`.

**Add `rootID` to execution, permission, and form events.** Clients could attribute every event without any lookup. But `rootID` is derivable from Session history, and durable events record only irreducible facts. Rejected for durable events; reconsider for the non-durable permission and form events if a client needs it.

**Move pending requests into one process-global registry.** Reads and replies would no longer need any Location lookup. Rule evaluation needs Location services, but holding a pending request does not. The cost is a refactor of `Permission.Service` and `Form.Service`, and their lifecycle would have to follow Location shutdown, which Locations own today. Deferred; the running-Location read is enough for this proposal.

## Subagent runs should become typed

This is a separate proposal; it does not block the family read. The link between a `subagent` tool call and the child Session it started exists only as untyped metadata:

- The tool part keeps `{ sessionID, status: "running" }` forever for a background run.
- Completion arrives as a synthetic message with `metadata: { source: "subagent", childID, agent, state }`, which the TUI parses field by field. The web app's background panel counts running subagents from their Session status, but still names each one by scanning its loaded transcript for the latest `subagent` tool call.
- A child can be continued by later tool calls, and the TUI marks a subagent row as running whenever its child is running (`routes/session/index.tsx`, the `Subagent` component). Continuing a subagent therefore makes every earlier, finished row for that child spin again.

The fix is to record each run with `{ assistantMessageID, toolCallID, background }` and expose the child's current run on the child Session. Both IDs are needed because a tool-call ID is unique only within its Step. A row is running exactly when its child is running and the child's current run is that call, and a completion notice carries the run's typed identity and outcome. The durable shape of a run is left to that proposal.

## Follow-ups outside this proposal

- `session.wait` returns no outcome and blocks without a signal while a permission or form is pending. The iOS app long-polls it in 25-second windows after every send, for Live Activities, and for voice.
- A permission prompt for a child shows without the tool's input, because the TUI reads the tool call from the child's transcript, which the root view has not loaded (`routes/session/permission.tsx`). The request could carry its tool input instead.

## Open questions

- Whether `status` on `Session.Info` and `rootID` on `/session/active` entries start experimental is left for review. [`AGENTS.md`](../../AGENTS.md) puts experimental fields on stable endpoints under an `experimental` key, so clients would read `session.experimental.status` and `entry.experimental.rootID`. This proposal keeps both as plain fields until that is decided.

## Out of scope

More than one server process on one database. [Execution Is Process-Local](./session.md#execution-is-process-local) still holds: another process's executions are invisible to this process's `status`, `/session/active`, and event stream.

For `BURROW`, the TUI goes from 199 requests, 31 of them still failing, to two, and the phone shows permission requests from subagents in other worktrees, which it cannot show today.
