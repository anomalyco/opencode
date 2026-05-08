---
name: proof
description: Create, edit, comment on, share, and run human-in-the-loop iteration loops over markdown documents via Proof's web API. Use when asked to "proof", "share a doc", "create a proof doc", "comment on a document", "suggest edits", "review in proof", "iterate on this doc in proof", "HITL this doc", "sync a Proof doc to local", when a caller needs an HITL review loop over a local markdown file (e.g., ce-brainstorm, ce-ideate, or ce-plan handoff), or when given a proofeditor.ai URL. Prefer this skill for any workflow whose output is a Proof URL or that uses a Proof doc as the review surface, even when not named explicitly.
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

When a caller (e.g., `ce-brainstorm`, `ce-plan`) needs to upload a local markdown doc, collect structured human feedback in Proof, and sync the final doc back to disk, load `references/hitl-review.md` for the full loop spec: invocation contract, mark classification (change / question / objection / ambiguous), idempotent ingest passes, exception-based terminal reporting, and end-sync atomic write.

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

**Every mutation requires a `baseToken`.** Read it from `/state.mutationBase.token` (or `/snapshot.mutationBase.token`) immediately before each write, and include it in the request body. On `BASE_TOKEN_REQUIRED` or `STALE_BASE`, re-read and retry once. See the baseToken recipe in `references/hitl-review.md`.

**`Idempotency-Key` header** is recommended on every mutation for safe automation retries; required when `/state.contract.idempotencyRequired` is true.

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
      {"op": "insert_after", "ref": "b3", "block": {"markdown": "## New section"}}
    ]
  }'
```

Supported `op` kinds inside `operations`: `replace_block`, `insert_before`, `insert_after`, `delete_block`, `replace_range` (uses `fromRef` + `toRef`), `find_replace_in_block` (takes `occurrence: "first" | "all"`). Read `/snapshot` to get stable block `ref` IDs and the `mutationBase.token`.

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
# Read
curl -s "https://www.proofeditor.ai/api/agent/abc123/state" \
  -H "x-share-token: xxx"

# Get baseToken for the next mutation
BASE=$(curl -s "https://www.proofeditor.ai/api/agent/abc123/state" \
  -H "x-share-token: xxx" | jq -r '.mutationBase.token')

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
- Read a fresh `baseToken` before every mutation; on `STALE_BASE`, re-read and retry once
