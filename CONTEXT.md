# Domain Glossary — unleashlive/opencode

This file lives at the root because every collab feature is built on the same
small set of domain terms.  Update it as the model evolves.  Reach for an ADR
in [`docs/adr/`](docs/adr/README.md) only when a decision is hard to reverse,
surprising without context, and the result of a real trade-off.

---

## Core Terms

**Collab Session**
A multi-user coding context where two or more GitHub org members share a
common LLM interaction thread, a Prompt Queue, one or more Session Repos
checked out to a single Session Branch, and one underlying Native Session.
Persists on the server until a Driver explicitly deletes it (soft-delete —
`deleted_at` timestamp on the row).  Extends opencode's native Session
primitive.

**Session** *(opencode native)*
A single LLM interaction thread inside opencode — a sequence of user
messages, assistant turns, tool calls and code changes.  In solo mode, one
user owns one Session.  A Collab Session wraps **exactly one** Native
Session, identified by its `Native Session ID`.

**Native Session ID**
The id of the opencode Session that a Collab Session is bound to.  Created
lazily by the server's pre-warm step (or by the first approve / first
direct-dispatch in FIFO+Driver mode) and stored as
`collab_session.session_id` in the DB.  Once linked, the right-hand iframe
in the collab UI loads `/<base64(workspaceDirectory)>/session/<nativeSessionId>?embed=collab&cs=<collabSessionId>`.

---

## Roles

**Driver**
A Collab Session participant with the most authority.  Can:
- Submit prompts that dispatch **directly** to the LLM (in FIFO mode), no
  approval needed
- Approve or reject Prompt Suggestions from Contributors
- Resolve the Vote Pool in Vote Mode
- Change any participant's role
- Invite new participants
- Delete the entire Collab Session

Any Driver can approve any Suggestion — first approval wins.

**Contributor**
A Collab Session participant who can submit Prompt Suggestions into the
pending queue (FIFO mode) or into the Vote Pool (Vote mode) but cannot
execute them directly.  Suggestions need a Driver to approve (FIFO) or the
pool resolved (Vote) before reaching the LLM.

**Viewer**
A Collab Session participant with read-only access.  Sees all prompts, LLM
responses, code changes and typing indicators in real time but cannot send,
suggest, or vote.

---

## Prompt Flow

**Prompt Suggestion**
A row in `collab_suggestion`.  Has one of four statuses:

- `pending` — submitted, waiting on Driver approval (FIFO) or pool
  resolution (Vote)
- `approved` — Driver has approved (or FIFO+Driver enqueued directly),
  picked up by the queue executor next
- `submitted` — the queue executor has already dispatched it to the
  native opencode Session via `prompt_async`.  Set by the executor
  itself so `_scheduleNext` doesn't loop on the same row.
- `rejected` — Driver said no; never executes

**Prompt Queue**
The ordered list of `approved` suggestions awaiting LLM execution.
Serialized by a per-session in-memory semaphore (`locks` Map in
`packages/collab/src/queue.ts`) — only one prompt runs at a time.  The
executor is registered per session in
`registerQueueExecutor(collabSessionId)`.

**FIFO mode**
- **Driver prompt** → bypasses approval entirely; `Queue.enqueue` inserts
  the suggestion directly as `approved`, the executor picks it up, marks
  it `submitted`, dispatches to the LLM.  No left-panel queue entry.
- **Contributor prompt** → inserted as `pending`; needs a Driver to call
  `/approve/<id>`.

**Vote Pool**
- Everyone (Drivers + Contributors) submits prompts as `pending` into the
  pool.  Drivers do NOT get a Direct-dispatch bypass in this mode.
- Any non-Viewer can cast one vote per pending suggestion.
- A Driver calls `/resolve` to pick the winner.  Winner = highest
  `vote_score`, ties broken by earliest `created_at`.  Winner's status →
  `approved`; all other pending suggestions in the pool → `rejected`.
  The executor then dispatches the winner.

**Seed Prompt**
A single bootstrap prompt the server sends to the Native Session 200 ms
after Collab Session creation (in `preWarmNativeSession` →
`sendSeedPrompt`).  Contents include the session name, linked repos, and
session branch — gives the LLM context that it's in a multi-user collab
session and produces a visible conversation in the iframe so the editor
isn't empty when a user first opens the page.

---

## Session Configuration

**Visibility Mode**
A Driver-configured field on the Collab Session controlling how much
pre-submit activity leaks to others.  Stored as
`collab_session.visibility_mode`.

- `typing` *(default)* — pulsing three-dot Typing Indicator appears next
  to a participant's avatar while they have non-empty draft text in the
  editor.  No content is broadcast.
- `submitted` — others only see a prompt once it lands in the queue.  No
  typing indicator.

> Historical: a `live` mode that broadcast keystroke-by-keystroke drafts
> existed and was removed.  Old DB rows with `visibility_mode = 'live'`
> are still accepted (the column is `TEXT`, no enum) and behave like
> `submitted` since no keystroke broadcast is emitted anymore.

**Queue Mode**
A Driver-configured field (`fifo` | `vote`) that determines how the
Prompt Queue resolves concurrent submissions.  See FIFO mode / Vote Pool
above.

**Session Branch**
The git branch every linked Session Repo is checked out to.  Stored as
`collab_session.branch`.  At session creation:

- If the Driver supplies a name, that name is used verbatim (sanitised
  to git-ref-safe form, capped at 100 chars).
- Otherwise the server generates `collab/<slugified-name>-<short-id>`.

`initSessionWorkspace` checks out the branch in each cloned repo,
falling back through: existing local branch → tracking `origin/<name>`
→ create new branch off current `HEAD`.  Every commit produced inside
the workspace is auto-tagged with `Collab-Branch: <name>` via the
prepare-commit-msg hook.

---

## Repos & Workspace

**Session Repos**
The set of GitHub org repositories a Driver selects when creating a
Collab Session.  Stored as rows in `collab_repo`.  Cloned by
`initSessionWorkspace` into `/var/opencode/workspaces/<sessionId>/<repoName>/`
using `GITHUB_TOKEN` for authentication (supports private repos).
Participants never need local copies.

**Workspace Init Status**
A `Collab Session`'s lifecycle for the server-side workspace (clone +
branch checkout + Native Session pre-warm).  One of `pending`, `ready`,
`failed`.  Persisted as `collab_session.init_status` and broadcast as
`collab:workspace_ready` / `collab:workspace_failed` SSE events.  The
SPA gates the iframe mount on `ready` — mounting earlier (e.g. after a
clone failure) lands opencode against an empty workspace and the
prompt input locks up.  A Driver can retry a failed init via
`POST /collab/session/:id/reinit`.

**Workspace Directory**
The path handed to opencode as the Native Session's working directory.
Computed by `nativeSessionDirectory(sessionId, repos)`:

- Any repo linked → first repo's subdirectory
  (`/var/opencode/workspaces/<id>/<repoName>/`).  Isolates the LLM, file
  tree, terminal panel, git diff/review pane and shell tool to one
  project's GitHub folder.  For multi-repo sessions the LLM can still
  `cd ../<other-repo>` to reach siblings, but the default scope is
  *the project*.
- No repos → workspace root (`/var/opencode/workspaces/<id>`).

**Commit Hook**
A `prepare-commit-msg` shell script installed in `.git/hooks/` of every
cloned repo by `installCollabCommitHook`.  Appends these trailers to
every fresh commit message (skipped for merges, squashes, and `--amend`
without `-m`):

```
Collaborative-Commit: true
Collab-Session: <session name>
Collab-Session-Id: cs_<id>
Collab-Repo: <org/repo>
Collab-Branch: <branch>
```

Re-installed on every session-init so a renamed session propagates.
The hook is a no-op if the trailer is already present, so amending an
existing collab commit doesn't duplicate trailers.

---

## Realtime

**SSE Stream**
A `text/event-stream` connection at
`GET /collab/session/<id>/events` per participant.  Server-side
`broadcastSse(collabSessionId, event)` fans out `CollabEvent`s to every
registered listener for that session.

Events the server broadcasts:
- `collab:participant_joined` / `collab:participant_left`
- `collab:role_changed`
- `collab:prompt_submitted` (executor picked it up)
- `collab:prompt_suggestion` (newly added to pool)
- `collab:suggestion_approved` / `collab:suggestion_rejected`
- `collab:vote_cast`, `collab:vote_winner`
- `collab:queue_update` (full pending pool — used to refresh the queue
  panel)
- `collab:typing_start` / `collab:typing_stop`
- `collab:session_deleted`
- `collab:native_session_linked` (the Native Session ID is now set)

**Typing Indicator**
A debounced presence signal.  When a user types in the iframe editor,
the in-iframe `PromptInput` postMessages
`{ type: "opencode:collab-typing", typing: true }` to the parent collab
page after the first keystroke and `{ typing: false }` 2 s after the
last (or immediately on submit).  The parent forwards to
`POST /collab/session/<id>/typing`, which broadcasts
`collab:typing_start` / `collab:typing_stop` over SSE.  Other clients
add/remove the user's GitHub login to `typingUsers` and render three
pulsing blue dots next to their avatar in the participants list.

---

## Embed Mode

**Embed Mode**
A UX state of the opencode SPA, activated by the query string
`?embed=collab&cs=<collabSessionId>` on the URL the parent collab page
loads into the iframe.  Detected and persisted in `sessionStorage` by
`utils/collab-embed.ts` so in-iframe navigation that drops the query
string still keeps the embed mode active.

In embed mode the SPA:
- Hides the project sidebar and renders `CollabEmbedSidebar` (a list of
  the user's collab sessions) instead.  Clicking a session navigates the
  *top* window via `navigateTopToCollabSession(id)`.
- Leaves the full opencode `PromptInput` visible with every shortcut
  (⌘P palette, `/` slash, `@` mentions, attachments, history, model /
  agent / mode dropdowns) — but intercepts the submit.
- On submit, the editor's text is extracted and postMessage'd to the
  parent collab page as
  `{ type: "opencode:collab-prompt-submit", content }`.  The parent
  forwards via `collab.submitPrompt(content)` → `POST /collab/session/<id>/prompt`
  so the suggestion goes through the role/queue/vote routing instead
  of dispatching straight to the LLM.

---

## Authentication

**GitHub OAuth**
Two-leg flow at `/collab/auth/github` → callback at
`/collab/auth/github/callback`.  Requested scopes: `read:org`,
`read:user`, `user:email`.

**OAuth State**
A base64url-encoded JSON envelope `{ n: <nonce>, inv?, next? }` carried
both in the `state` query param (GitHub round-trips it) AND in a
`collab_oauth_state` cookie of the same value.  The cookie is the CSRF
proof; the URL state carries the pending Invite token and post-auth
return-to URL, so the callback can recover them even if cookies are
dropped.

**Auth Session Cookie**
`collab_sid=<token>` with `Path=/`.  Token is a 32-byte hex string keyed
into the `collab_auth_session` table along with the user's GitHub
access token, login, id and avatar URL.  Survives container restarts
(was in-memory in the original code).

**Cookie Authorization Scope**
A valid `collab_sid` is a **scoped** credential, not a server-admin
credential.  Three rules decide whether the cookie alone is enough
to pass the auth gate:

1. **Public path** (e.g. SPA shell, `/global/health`, assets) — allow.
2. **Workspace-addressing request** (header `x-opencode-directory`,
   query `directory=…`, or query `location[directory]=…`) — allow
   only if the directory resolves to a `Workspace Directory` of a
   `Collab Session` the cookie's user is a `Participant` of.
3. **Native-session-addressing request** (e.g. `/event/<sessionId>`)
   — allow only if the `Native Session ID` resolves (via
   `collab_session.session_id`) to a `Collab Session` the user is
   a `Participant` of.

Anything else (e.g. `/global/event`, `/global/config`,
`/global/dispose`, `/global/upgrade`, or an HttpApi route with no
workspace/native-session identifier) the cookie does not gate.  Those
routes still accept the server's basic-auth credential (used by
internal self-fetches) but reject cookies — they're server-admin or
cross-tenant by nature.

**Invite Link**
`https://<host>/collab/invite/<uuid-token>`.  Rows in `collab_invite`
carry `role`, `created_by`, `expires_at` (default 72 h), and `used_at`
(once redeemed).  Validates on redemption: not used, not expired, user
passes Org Membership Check.  Then `Participant.addParticipant` is
called and `Invite.redeemInvite` flips the token to used.  Role is
*set* at invite creation but a Driver can change it later via
`/participant/<ghId>/role`.

**Org Membership Check**
Two-pass GitHub API probe in `isOrgMember(...)`:

1. With the user's own OAuth access token →
   `GET /user/memberships/orgs/<org>` — returns the requesting user's
   own membership status regardless of privacy/visibility.  This is
   the authoritative answer because it works for private org members
   and SSO-protected orgs (assuming the user authorised SSO on the
   OAuth token).
2. Falls back to the server PAT (`GITHUB_TOKEN`) hitting
   `GET /orgs/<org>/members/<login>` if the user-token probe is
   inconclusive.

Both probes emit `[collab.auth] ...` lines to stderr with status codes
and `x-github-sso` header for diagnostics.

---

## Storage

**collab_session** — one row per Collab Session.
**collab_participant** — one row per (session, github_id) tuple.
**collab_repo** — one row per linked org/repo.
**collab_suggestion** — one row per prompt suggestion (with status).
**collab_vote** — one row per (suggestion, voter) tuple.
**collab_invite** — one row per generated invite token.
**collab_auth_session** — persisted OAuth sessions (auth cookie store).

All tables migrate idempotently on server startup via
`runCollabMigrations()` (CREATE TABLE IF NOT EXISTS, plus a
`PRAGMA table_info` probe to back-fill new columns like
`collab_session.branch`).

---

## Versioning / Upstream sync

This fork tracks `anomalyco/opencode` on the `main` branch and lives on
the `collab` branch.  `.github/workflows/upstream-sync.yml` runs weekly
and opens a PR against `main` when a new upstream tag appears.  Periodic
rebases of `collab` onto `main` keep the collab feature set on top of
the latest opencode release.
