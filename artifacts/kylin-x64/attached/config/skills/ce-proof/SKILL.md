---
name: ce-proof
description: Create, share, view, comment on, edit, and run human-in-the-loop review loops over markdown documents via Proof, the collaborative markdown editor at proofeditor.ai ("Proof editor"). Use when the user wants to render or view a local markdown file in Proof, share markdown to get a URL, iterate collaboratively on a Proof doc, comment on or suggest edits in Proof, HITL a spec/plan/draft for human review, sync a Proof doc back to local, or work from a proofeditor.ai URL. Trigger on phrases like "view this in proof", "share to proof", "iterate with proof", or "HITL this doc", and on ce-brainstorm / ce-ideate / ce-plan handoffs for human review. Also match clear requests for a rendered/shared markdown review surface even if the user does not name Proof. Do not trigger on "proof" meaning evidence, math/logic proof, burden of proof, proof-of-concept, or bare "proofread this" requests where inline text review is expected.
allowed-tools:
  - Bash
  - Read
  - Write
  - WebFetch
---

# Proof - Collaborative Markdown Editor

Proof is a collaborative document editor for humans and agents. It supports two modes:

1. **Web API** - Create and edit shared documents via HTTP (no install needed)
2. **Local Bridge** - Drive the macOS Proof app via localhost:9847

## Identity and Attribution

Every write to a Proof doc must be attributed. Two fields carry the agent's identity:

- **Machine ID (`by` on every op, `X-Agent-Id` header):** `ai:compound-engineering` — stable, lowercase-hyphenated, machine-parseable. Appears in marks, events, and the API response.
- **Display name (`name` on `POST /presence`):** `Compound Engineering` — human-readable, shown in Proof's presence chips and comment-author badges.

Set the display name once per doc session by posting to presence with the `X-Agent-Id` header; Proof binds the name to that agent ID for the session. These values are the defaults for any caller of this skill; callers running HITL review (`references/hitl-review.md`) may pass a different `identity` pair if a distinct sub-agent should own the doc. Do not use `ai:compound` or other ad-hoc variants — identity stays uniform unless a caller explicitly overrides it.

## Human-in-the-Loop Review Mode

Human-in-the-loop iteration over an existing local markdown file: upload to Proof, let the user annotate in Proof's web UI, ingest feedback as in-thread replies and tracked edits, and sync the final doc back to disk. Two entry points, identical mechanics — load `references/hitl-review.md` for the full loop spec (invocation contract, mark classification, idempotent ingest passes, exception-based terminal reporting, end-sync atomic write) in either case:

- **Direct user request** — a bare user phrase naming a local markdown file and asking to iterate collaboratively via Proof: "share this to proof so we can iterate", "iterate with proof on this doc", "HITL this file with me", "let's get feedback on this in proof", "open this in proof editor so I can review". The file is whichever markdown the user just created, edited, or referenced; if ambiguous, ask which file. This is a first-class entry point — do not require an upstream caller.
- **Upstream skill handoff** — `ce-brainstorm`, `ce-ideate`, or `ce-plan` finishes a draft and hands it off for human review before the next phase, passing the file path and title explicitly.

## Web API (Primary for Sharing)

### Create a Shared Document

No authentication required. Returns a shareable URL with access token.

```bash
curl -X POST https://www.proofeditor.ai/share/markdown \
  -H "Content-Type: application/json" \
  -d '{"title":"My Doc","markdown":"# Hello\n\nContent here."}'
```

**Response format:**
```json
{
  "slug": "abc123",
  "tokenUrl": "https://www.proofeditor.ai/d/abc123?token=xxx",
  "accessToken": "xxx",
  "ownerSecret": "yyy",
  "_links": {
    "state": "https://www.proofeditor.ai/api/agent/abc123/state",
    "ops": "https://www.proofeditor.ai/api/agent/abc123/ops"
  }
}
```

Use the `tokenUrl` as the shareable link. The `_links` give you the exact API paths.

### Read a Shared Document

```bash
curl -s "https://www.proofeditor.ai/api/agent/{slug}/state" \
  -H "x-share-token: <token>"
```

### Edit a Shared Document

All operations go to `POST https://www.proofeditor.ai/api/agent/{slug}/ops`

**Note:** Use the `/api/agent/{slug}/ops` path (from `_links` in create response), NOT `/api/documents/{slug}/ops`.

**Authentication for protected docs:**
- Header: `x-share-token: <token>` or `Authorization: Bearer <token>`
- Token comes from the URL parameter: `?token=xxx` or the `accessToken` from create response
- Header: `X-Agent-Id: ai:compound-engineering` (required for presence; include on ops for consistent attribution)

**Wire-format reminder.** `/api/agent/{slug}/ops` uses a top-level `type` field; `/api/agent/{slug}/edit/v2` uses an `operations` array where each entry has `op`. Do not mix — sending `op` to `/ops` returns 422.

**Every mutation requires a `baseToken`.** Reuse the `mutationBase.token` from the most recent `/state` or `/snapshot` read — tokens don't go stale in seconds, and `STALE_BASE` is a recoverable error. On `BASE_TOKEN_REQUIRED` or `STALE_BASE`, re-read and retry once. Only do a pre-mutation read if no prior read has happened in this session. See the baseToken recipe in `references/hitl-review.md`.

`/edit/v2` block refs are a separate concern: they can drift across revisions, so re-fetch `/snapshot` for fresh refs before a block edit if any writes have landed since your last snapshot.

**Retry discipline after mutation errors — verify before retrying.** An error response is not proof that nothing was written.

- `STALE_BASE`, `BASE_TOKEN_REQUIRED`, `MISSING_BASE`, `INVALID_BASE_TOKEN` — pre-commit, token-related. Re-read `/state` and retry once with the same payload and a fresh `baseToken`. A generic mutate helper can auto-retry these.
- `ANCHOR_NOT_FOUND`, `ANCHOR_AMBIGUOUS` — pre-commit, but the `quote` no longer uniquely matches content. Re-reading does not help by itself; the caller must tighten or regenerate the anchor before retrying. Do not auto-retry blindly.
- `INVALID_OPERATIONS`, `INVALID_REQUEST`, `INVALID_REF`, `INVALID_BLOCK_MARKDOWN`, `INVALID_RANGE`, `INVALID_MARKDOWN`, 422 — pre-commit, but the payload is wrong. Do not retry blindly; fix the payload first.
- `COLLAB_SYNC_FAILED`, `REWRITE_BARRIER_FAILED`, `PROJECTION_STALE`, `INTERNAL_ERROR`, 5xx, network timeout, and any **202 with `collab.status: "pending"`** — the canonical doc may have been written even though the call looks like a failure. Before any retry, re-read `/state` and check whether the intended mark/edit is already present; only retry if it isn't.
- `Idempotency-Key` (see below) protects against double-apply *on the same request* (e.g., TCP-level retry). It does not help if you build a new request body and send a second call — that is a new logical write with a new key.

Duplicate-mark incidents usually come from retrying a `comment.add` or `suggestion.add` after a timeout without verifying. When in doubt: re-read, diff, then decide.

**`Idempotency-Key` header** is recommended on every mutation for safe automation retries; required when `/state.contract.idempotencyRequired` is true. Use the same key when retrying the exact same logical write (same payload) so the server can collapse the retry. A new key means a new write — even if the payload is identical.

**Comment on text:**
```json
{"type": "comment.add", "quote": "text to comment on", "by": "ai:compound-engineering", "text": "Your comment here", "baseToken": "<token>"}
```

**Reply to a comment:**
```json
{"type": "comment.reply", "markId": "<id>", "by": "ai:compound-engineering", "text": "Reply text", "baseToken": "<token>"}
```

**Resolve / unresolve a comment:**
```json
{"type": "comment.resolve", "markId": "<id>", "by": "ai:compound-engineering", "baseToken": "<token>"}
{"type": "comment.unresolve", "markId": "<id>", "by": "ai:compound-engineering", "baseToken": "<token>"}
```

**Suggest a replacement (pending — user must accept/reject):**
```json
{"type": "suggestion.add", "kind": "replace", "quote": "original text", "by": "ai:compound-engineering", "content": "replacement text", "baseToken": "<token>"}
```

**Suggest and immediately apply (tracked but committed — user can reject to revert):**
```json
{"type": "suggestion.add", "kind": "replace", "quote": "original text", "by": "ai:compound-engineering", "content": "replacement text", "status": "accepted", "baseToken": "<token>"}
```

`status: "accepted"` creates the suggestion mark and commits the change in one call. The mark persists as an audit trail with per-edit attribution and a reject-to-revert affordance. Works with `kind: "insert" | "delete" | "replace"`.

**Accept or reject an existing suggestion:**
```json
{"type": "suggestion.accept", "markId": "<id>", "by": "ai:compound-engineering", "baseToken": "<token>"}
{"type": "suggestion.reject", "markId": "<id>", "by": "ai:compound-engineering", "baseToken": "<token>"}
```

`suggestion.resolve` is not supported — use accept or reject instead.

**Bulk rewrite (whole-doc replacement):**
```json
{"type": "rewrite.apply", "content": "full new markdown", "by": "ai:compound-engineering", "baseToken": "<token>"}
```

**Block-level edits via `/edit/v2`** (separate endpoint, separate shape):
```bash
curl -X POST "https://www.proofeditor.ai/api/agent/{slug}/edit/v2" \
  -H "Content-Type: application/json" \
  -H "x-share-token: <token>" \
  -H "X-Agent-Id: ai:compound-engineering" \
  -H "Idempotency-Key: <uuid>" \
  -d '{
    "by": "ai:compound-engineering",
    "baseToken": "mt1:<token>",
    "operations": [
      {"op": "replace_block", "ref": "b3", "block": {"markdown": "Updated paragraph."}},
      {"op": "insert_after", "ref": "b3", "blocks": [{"markdown": "## New section"}]}
    ]
  }'
```

Per-op body shape (singular `block` vs plural `blocks` is load-bearing — sending the wrong one returns 422):

| op | body fields |
|---|---|
| `replace_block` | `ref`, `block: {markdown}` |
| `insert_after` | `ref`, `blocks: [{markdown}, ...]` |
| `insert_before` | `ref`, `blocks: [{markdown}, ...]` |
| `delete_block` | `ref` |
| `replace_range` | `fromRef`, `toRef`, `blocks: [{markdown}, ...]` |
| `find_replace_in_block` | `ref`, `find`, `replace`, `occurrence: "first" \| "all"` |

Read `/snapshot` to get stable block `ref` IDs. `operations` commits atomically — either every op lands or none do — so one `/edit/v2` call can batch dozens of block edits safely and efficiently (see the bulk-sweep guidance in `references/hitl-review.md` Phase 2.4).

**Editing while a client is connected is fine.** `/edit/v2`, `suggestion.add` (including `status: "accepted"`), and all comment ops work during active collab. Only `rewrite.apply` is blocked by `LIVE_CLIENTS_PRESENT` — it would clobber in-flight Yjs edits.

**When the loop breaks.** If a mutation keeps failing after a fresh read and one retry, or state across reads looks inconsistent, call `POST https://www.proofeditor.ai/api/bridge/report_bug` with the failing request ID, slug, and raw response. The server enriches and files an issue.

### Known Limitations (Web API)

- Bridge-style endpoints (`/d/{slug}/bridge/*`) require client version headers (`x-proof-client-version`, `x-proof-client-build`, `x-proof-client-protocol`) and return 426 CLIENT_UPGRADE_REQUIRED without them. Use `/api/agent/{slug}/ops` instead.

## Local Bridge (macOS App)

Requires Proof.app running. Bridge at `http://localhost:9847`.

**Required headers:**
- `X-Agent-Id: claude` (identity for presence)
- `Content-Type: application/json`
- `X-Window-Id: <uuid>` (when multiple docs open)

### Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/windows` | List open documents |
| GET | `/state` | Read markdown, cursor, word count |
| GET | `/marks` | List all suggestions and comments |
| POST | `/marks/suggest-replace` | `{"quote":"old","by":"ai:compound-engineering","content":"new"}` |
| POST | `/marks/suggest-insert` | `{"quote":"after this","by":"ai:compound-engineering","content":"insert"}` |
| POST | `/marks/suggest-delete` | `{"quote":"delete this","by":"ai:compound-engineering"}` |
| POST | `/marks/comment` | `{"quote":"text","by":"ai:compound-engineering","text":"comment"}` |
| POST | `/marks/reply` | `{"markId":"<id>","by":"ai:compound-engineering","text":"reply"}` |
| POST | `/marks/resolve` | `{"markId":"<id>","by":"ai:compound-engineering"}` |
| POST | `/marks/accept` | `{"markId":"<id>"}` |
| POST | `/marks/reject` | `{"markId":"<id>"}` |
| POST | `/rewrite` | `{"content":"full markdown","by":"ai:compound-engineering"}` |
| POST | `/presence` | `{"status":"reading","summary":"..."}` |
| GET | `/events/pending` | Poll for user actions |

### Presence Statuses

`thinking`, `reading`, `idle`, `acting`, `waiting`, `completed`

## Workflow: Review a Shared Document

When given a Proof URL like `https://www.proofeditor.ai/d/abc123?token=xxx`:

1. Extract the slug (`abc123`) and token from the URL
2. Read the document state via the API
3. Add comments or suggest edits using the ops endpoint
4. The author sees changes in real-time

```bash
# Read once — the same response yields both the doc content and the baseToken for every mutation below.
STATE=$(curl -s "https://www.proofeditor.ai/api/agent/abc123/state" \
  -H "x-share-token: xxx")
BASE=$(printf '%s' "$STATE" | jq -r '.mutationBase.token')
# Inspect doc fields as needed: printf '%s' "$STATE" | jq '.markdown, .revision'

# Comment
curl -X POST "https://www.proofeditor.ai/api/agent/abc123/ops" \
  -H "Content-Type: application/json" \
  -H "x-share-token: xxx" \
  -H "X-Agent-Id: ai:compound-engineering" \
  -d "$(jq -n --arg base "$BASE" '{type:"comment.add",quote:"text",by:"ai:compound-engineering",text:"comment",baseToken:$base}')"

# Suggest edit (tracked, pending)
curl -X POST "https://www.proofeditor.ai/api/agent/abc123/ops" \
  -H "Content-Type: application/json" \
  -H "x-share-token: xxx" \
  -H "X-Agent-Id: ai:compound-engineering" \
  -d "$(jq -n --arg base "$BASE" '{type:"suggestion.add",kind:"replace",quote:"old",by:"ai:compound-engineering",content:"new",baseToken:$base}')"

# Suggest and immediately apply (tracked, committed)
curl -X POST "https://www.proofeditor.ai/api/agent/abc123/ops" \
  -H "Content-Type: application/json" \
  -H "x-share-token: xxx" \
  -H "X-Agent-Id: ai:compound-engineering" \
  -d "$(jq -n --arg base "$BASE" '{type:"suggestion.add",kind:"replace",quote:"old",by:"ai:compound-engineering",content:"new",status:"accepted",baseToken:$base}')"
```

## Workflow: Create and Share a New Document

```bash
# 1. Create
RESPONSE=$(curl -s -X POST https://www.proofeditor.ai/share/markdown \
  -H "Content-Type: application/json" \
  -d '{"title":"My Doc","markdown":"# Title\n\nContent here."}')

# 2. Extract URL and token
URL=$(echo "$RESPONSE" | jq -r '.tokenUrl')
SLUG=$(echo "$RESPONSE" | jq -r '.slug')
TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken')

# 3. Bind display name via presence
curl -s -X POST "https://www.proofeditor.ai/api/agent/$SLUG/presence" \
  -H "Content-Type: application/json" \
  -H "x-share-token: $TOKEN" \
  -H "X-Agent-Id: ai:compound-engineering" \
  -d '{"name":"Compound Engineering","status":"reading","summary":"Uploaded doc"}'

# 4. Share the URL
echo "$URL"

# 5. Make edits using the ops endpoint (baseToken required)
BASE=$(curl -s "https://www.proofeditor.ai/api/agent/$SLUG/state" \
  -H "x-share-token: $TOKEN" | jq -r '.mutationBase.token')
curl -X POST "https://www.proofeditor.ai/api/agent/$SLUG/ops" \
  -H "Content-Type: application/json" \
  -H "x-share-token: $TOKEN" \
  -H "X-Agent-Id: ai:compound-engineering" \
  -d "$(jq -n --arg base "$BASE" '{type:"comment.add",quote:"Content here",by:"ai:compound-engineering",text:"Added a note",baseToken:$base}')"
```

## Workflow: Pull a Proof Doc to Local

Sync the current Proof doc state to a local markdown file. Used by:

- HITL review end-sync (`references/hitl-review.md` Phase 5) when the doc originated from a local file
- Ad-hoc snapshots of a Proof doc to disk (before closing the tab, archiving, handing off)
- Refreshing a local working copy against the live Proof version

```bash
SLUG=<slug>
TOKEN=<accessToken>
LOCAL=<absolute-path>

# One read to a temp file — avoids passing markdown through $(...), which would strip trailing newlines.
STATE_TMP=$(mktemp)
curl -s "https://www.proofeditor.ai/api/agent/$SLUG/state" \
  -H "x-share-token: $TOKEN" > "$STATE_TMP"
REVISION=$(jq -r '.revision' "$STATE_TMP")

# Atomic write: stream .markdown bytes directly to a temp sibling, then rename.
TMP="${LOCAL}.proof-sync.$$"
jq -jr '.markdown' "$STATE_TMP" > "$TMP" && mv "$TMP" "$LOCAL"
rm "$STATE_TMP"
```

`jq -jr` (`-j` no trailing newline, `-r` raw string) streams the markdown bytes straight to the temp file without going through a shell variable, so trailing newlines survive intact. `mv` within the same filesystem is atomic — a crashed write leaves the original untouched rather than a half-written file.

**Confirm before writing when the pull isn't directly asked for.** If a workflow ends up pulling as a side-effect of a different action (e.g., HITL review completion), surface the impending write with a short confirm like "Sync reviewed doc to `<localPath>`?" A silent overwrite is surprising — the user may have forgotten the local file exists in that session, or expected Proof to stay canonical until they explicitly asked to pull.

## Safety

- Use `/state` content as source of truth before editing
- During active collab use `edit/v2` (direct block changes) or `suggestion.add` (tracked changes); reserve `rewrite.apply` for no-client scenarios since it's blocked by `LIVE_CLIENTS_PRESENT` when anyone is connected
- Don't span table cells in a single replace
- Always include `by: "ai:compound-engineering"` on every op and `X-Agent-Id: ai:compound-engineering` in headers for consistent attribution
- Reuse `baseToken` from your most recent `/state` or `/snapshot` read; on `STALE_BASE`, re-read and retry once
