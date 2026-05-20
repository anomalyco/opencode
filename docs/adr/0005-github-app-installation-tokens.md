# ADR-0005: Replace static PAT-in-clone-URL with GitHub App installation tokens

- Status: Proposed
- Date: 2026-05-21

## Context

`workspace.ts:99-104` clones every Session Repo with the server PAT embedded
directly in the URL:

```ts
const cloneUrl = token
  ? `https://x-access-token:${token}@github.com/${repo}.git`
  : `https://github.com/${repo}.git`

await runAsync("git", ["clone", "--depth", "100", cloneUrl, dest], { env })
```

Git persists that URL in `.git/config`.  `DEPLOYMENT.md:281` calls this out as
an intentional convenience (*"The clone already has authentication baked into
the remote URL via the server-side PAT, so no token entry is required from the
participant"*) — but it has two unintended properties:

1. **Every participant who can `cat .git/config` from the iframe terminal can
   exfiltrate the PAT.**  The PAT has scopes `read:org` + `repo`
   (`.env.example:13-15`), so it grants org-wide write access to every private
   repo the PAT owner can see.
2. **The PAT belongs to a human** (`DEPLOYMENT.md:76-78` instructs a member
   to create it).  When that person leaves the org, every running session
   breaks; rotating the PAT requires editing Secrets Manager and restarting
   the task.

ADR-0003 reduces but does not eliminate the exposure: even non-root
participants can read files in the workspace they participate in.

## Decision

Replace the human PAT with a **GitHub App installation token** issued
per-session:

- Register a GitHub App in the `unleashlive` org (one-time setup).
- Install it into the org with the minimum required permissions:
  `Contents: Read & write`, `Pull requests: Read & write`,
  `Members: Read`.  No write scope on members.
- At session creation, the server mints a fresh installation token for
  **only the selected Session Repos** (GitHub App tokens support
  `repository_ids` scoping).
- Tokens have a 1-hour life; the server refreshes them on demand.  Clones
  are re-rewritten (`git remote set-url`) on refresh; the in-memory token
  is held in the collab session's runtime state.
- Replace `GITHUB_TOKEN` env var with `GITHUB_APP_ID` +
  `GITHUB_APP_PRIVATE_KEY` + `GITHUB_APP_INSTALLATION_ID`.
- For org-membership checks (`packages/opencode/src/collab/github-auth.ts`),
  switch the fallback probe from `GET /orgs/<org>/members/<login>` with PAT
  to the same endpoint with an app token (the `Members: Read` permission
  covers it).

## Consequences

**Positive**

- The credential in `.git/config` is short-lived (≤1 hour), narrowly scoped
  (only this session's repos), and not tied to any human.
- A leaked credential from the workspace dir is automatically invalid soon.
- Audit trail in GitHub shows actions attributed to the App, separately from
  human pushes.
- Member departures stop breaking sessions.

**Negative**

- One-time setup of the GitHub App and key storage.
- Token-refresh logic on long-running sessions (currently sessions don't
  expire; the executor would need to refresh before every `git push`).
- The current invite/auth UX shows org repos selected from the PAT's view;
  the App's view may differ (only repos it's installed on).  Acceptable —
  the App is installed org-wide.

## Alternatives considered

- **Keep the PAT, encrypt `.git/config` at rest.**  Rejected: the PAT is read
  by `git` from the file at use, so any encryption must be decrypted at use,
  which means a participant with shell access can do the same.
- **Use a deploy-key per repo.**  Rejected: deploy keys are repo-scoped, but
  setting them up per Session Repo at session-create time is more work than
  installing the App once.
- **Use the user's own OAuth token for git operations.**  Plausible long-term,
  but requires moving the `repo` scope into the OAuth app's request — which
  surfaces a "this app wants write access to your repos" consent screen for
  every Contributor.  Defer; revisit if we want true per-user attribution.
