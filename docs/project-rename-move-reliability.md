# Rename/move-resilient projects: field evidence & design

Status: proposal · Targets #23248, #34737, #44256, #44538, #29703, #27822
Environment studied: Windows 11, OpenCode Desktop 1.18.x, single-user install whose project folder
`C:\Users\skele\Documents\auto-resume` was renamed in Explorer to `OpenCode plugins`.

## 1. What actually breaks (measured, not guessed)

After an Explorer-side rename, sessions vanish from the UI and a ghost empty project appears whose
Delete button fails server-side. We instrumented a broken install and recovered it manually; these
are all locations that must move together for rename/move/delete to be correct:

| Layer | Location | What goes stale |
|---|---|---|
| Session rows | sqlite `session.directory`, `session.path` | absolute old path (forward-slashed, drive-letter prefix) |
| Event store | `event.data` (`session.created/updated`, tool parts) | old path embedded in JSON payloads |
| Message/part bodies | `message.data`, `part.data`, `todo.content` | old path inside tool inputs/outputs/diffs |
| Project registry | `project.worktree`, `project_directory` (empty in affected install) | worktree points at dead dir |
| **Desktop state** | `%APPDATA%\ai.opencode.desktop\opencode.global.dat` → `server.projects.local[]` | ghost registration keeps dead entry visible; Delete issues a request the backend rejects (dead path) |
| Desktop maps | same file, keys of form base64(path) e.g. `QzpcVXNlcnNc...` | permission/autoAccept maps keyed by encoded old path |

### 1.1 Encoding taxonomy (why naive replace/equality fails)

The same logical directory string occurs at **three escape depths** depending on payload nesting:

```
plain           C:\Users\u\Documents\proj            (session.directory)
json-escaped 1  C:\\Users\\u\\Documents\\proj        (single-encoded JSON fields)
json-escaped 2  C:\\\\Users\\\\u\\\\Documents\\\\proj (tool part embedded in event payload)
drive-less      Users/u/Documents/proj                (session.path)
relative        ../Documents/proj/x.js               (legitimate content — do NOT rewrite)
```

plus case variance (`C:` vs `c:` — see #44538) and base64(path) keying in Desktop state.
On one real install, ~6,900 payload fields across `message`/`part`/`event` needed rewriting;
string equality matched only a handful.

**Rule learned the hard way:** only rewrite occurrences whose *parent is the user's Documents/worktree
root*. Relative URLs like `../Documents/proj/x.js` inside recorded source code, error text pointing at
temp copies, and edit-diff `oldString` history are **content**, not references — rewriting them
falsifies history. Any matcher must anchor the full old-path (username included) with a trailing
word-boundary, and must NOT match sibling folders (`proj-old`) or other users' homes.

## 2. Root cause chain

1. Sessions are keyed to raw absolute path strings (`session.directory`); listing filters by strict
   equality (`listByProject()` in `packages/opencode/src/session/session.ts`).
2. Renames/moves change nothing opencode can observe before launch, so a new project identity is
   created for the new path while old rows keep the dead path (#23248 cases 1–2).
3. Desktop additionally persists its own registry (`server.projects.local[]`). After the DB is fixed,
   the registry still lists the dead worktree → ghost project; its Delete call fails because the
   backend resolves the worktree first (#34737).
4. Even when the session table is repaired, event-sourced payloads re-introduce stale directories
   unless migrated too (#44538 appendix).

## 3. Proposed behavior

### 3.1 Relink on detect (core, cross-platform)

At instance startup (and when opening a directory), if a known worktree no longer exists:

1. Re-identify the project:
   a. git remote fingerprint match against candidate folders (Desktop already fingerprints remotes),
   b. else unique basename match among recently-seen siblings of known roots,
   c. else surface an interactive "relink?" choice (Desktop dialog / CLI prompt), never silent.
2. On confirm, in ONE transaction:
   - update `project_directory` + `project.worktree`,
   - rewrite `session.directory` / `session.path` for all sessions of that project using an
     **encoding-preserving splice**: capture each match's literal separator runs and reuse them around
     the new basename (correct at any JSON depth by construction),
   - rewrite matching substrings inside `message.data`, `part.data`, `todo.content`, `event.data`
     scoped to those sessions' ids,
   - checkpoint WAL; run integrity + foreign-key checks; log a summary row-count.
3. Failure semantics: relocation runs best-effort - a failed migration logs and continues with
   pre-existing behavior rather than failing instance startup.
4. Emit a `project.relinked` event so every open client refreshes instead of showing ghosts.

Reference implementation shipped alongside this document:
`packages/opencode/src/project/relocation-paths.ts` (pure splicer, unit-tested incl. unicode
boundaries, triple-JSON depth, shallower/deeper moves, sibling-folder and other-user guards,
1MB perf smoke) and `packages/opencode/src/project/relocation.ts` (transactional wiring).

### 3.2 Canonicalization (fixes #44538 too)

Store `directory` as the resolved real path once per write (case-normalized per-platform semantics:
case-sensitive compare on Linux, insensitive on Win/macOS). All lookups compare canonical forms.

### 3.3 Delete project + contents

`DELETE /project/:id?mode=cascade|detach`:

- `cascade`: delete rows across `session`, `session_message`, `message`, `part`, `todo`,
  `session_share`, `session_input`, `session_context_epoch`, `permission`, `event` (by aggregate),
  then `project_directory` + `project`; emit `project.deleted`.
- `detach`: drop registry entries only (default when sessions exist, with count warning).
- Desktop: remove `server.projects.local[]` entry + base64(path)-keyed maps in `*.dat` state, then reload.

### 3.4 GUI affordances (Desktop)

- Project context menu: **Rename…** (move-aware, delegates to core relink), **Remove project**
  (with cascade warning + session count), alongside existing New/Open-folder flow.
- On detecting a missing worktree at launch: non-blocking banner "Project folder moved?
  Relink to <candidate> / Choose folder / Keep as offline".

## 4. Test plan sketch

- Unit: splice rewriter property tests over the §1.1 taxonomy × {rename, move, case-change};
  sibling-folder and other-user paths asserted untouched; relative URL content untouched.
- Integration: create sessions → rename dir out-of-band → relaunch → assert history visible under
  new path; delete cascade leaves zero orphan rows (FK check).
- Cross-platform matrix: Windows (case-insensitive FS), macOS APFS, Linux ext4, WSL UNC paths.
- Fixture: anonymized copy of the affected DB from this investigation available on request.

## 5. Non-goals / follow-ups

- Content-addressed session identity (path-independent IDs) — bigger refactor, tracked separately.
- Sync/multi-instance relink races — single-writer assumption documented for now.

---
*Authored from a live incident recovery; happy to split into code PRs per maintainer guidance.*
