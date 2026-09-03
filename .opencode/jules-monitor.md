# Jules Session Monitor

Whenever this agent session starts, always set up a Jules status monitor before doing other work:

1. Ensure `~/.config/opencode/scripts/jules_monitor.sh` exists (copy from `/home/team/Programming/Kernelopti/scripts/agents/jules_monitor.sh` if missing).
2. Ensure a workspace-scoped cron job runs it every 5 minutes, scoped to this session's workspace: `~/.config/opencode/scripts/jules_monitor.sh install` (idempotent — adds one `cd <workspace> && ...` entry per workspace that opencode is opened in).
3. Run `~/.config/opencode/scripts/jules_monitor.sh list` and register any in-flight sessions with `... add <session-id> "$PWD"`. Whenever you spawn a new Jules session for background work, register its ID too.
4. Run the script once to verify it works.
5. Spawn a sub agent (task tool, `general` type) to monitor the status: read `~/.jules/monitor_state` and `~/.jules/jules_monitor.log`, report transitions, `STUCK>=15m` sessions (AWAITING_USER_FEEDBACK/FAILED needing a nudge), and `COMPLETED` sessions.

See the `jules-monitor` skill for the full procedure.

## Jules MCP tools (how and when to use them)

The `jules_*` tools (create/list/status/approve/output) come from the jules MCP server, configured **per workspace** in this project's `.opencode/opencode.jsonc` (gitignored — it holds the `JULES_API_KEY`). Only workspaces with that config expose the tools; in other workspaces the `jules_*` tools do not exist.

Jules sessions are **account-global** on the Jules API: every session belongs to a GitHub repo, but the list/status tools return **all** sessions for the account with no repo filter. To keep sessions from leaking across workspaces:

- **Creating sessions**: always pass the current workspace's repo to `jules_create_session` / `jules_execute_and_wait` via `repoOwner` + `repoName` (derive from `git remote get-url origin`). Never default to another repo.
- **Listing / monitoring**: `jules_list_sessions`, `jules_list_stuck_sessions`, and `jules_get_status` return account-wide data — filter to the current workspace's repo before acting on anything. Never query, message, approve, or delete a session that belongs to another repo/workspace.
- **Registering with the tracker**: always record the workspace when registering a session, and filter by workspace when listing:
  ```bash
  ~/.config/opencode/scripts/jules_monitor.sh add <session-id> "$PWD"
  ~/.config/opencode/scripts/jules_monitor.sh list "$PWD"
  ```
  Only track and monitor sessions that belong to the current workspace.

## Failure routing to a Jules agent

Whenever the agent encounters a failure in this session — a `Step.Failed` error or a `+log` diagnostic part (provider error, truncated/dropped stream, inter-event stall gap, permission denial) — route it to a Jules agent for diagnosis and management.

This applies especially to problems with the **LLM or the opencode agent itself**: spawn the Jules agent **in relation to the local opencode workspace (its local fork) and in relation to the problem detected**. Otherwise the Jules agent stays dedicated to whichever repo/workspace was used and never gets tied to this fork.

1. **Target the local fork, not upstream.** The workspace pushes to a fork remote (here `teamopti` → `BrandonRaeder/TeamOptiOpencode3.git`); `origin`/`upstream` point to `anomalyco/opencode.git` and must NOT be used. Derive owner/name from the fork remote:
   ```bash
   git remote -v   # find the fork remote (BrandonRaeder-owned); here: teamopti
   # -> repoOwner=BrandonRaeder  repoName=TeamOptiOpencode3
   ```
2. **Spawn a diagnostic session** with `jules_create_session`, tied to the problem detected:
   - `repoOwner` / `repoName` from step 1 (the local fork)
   - `branch`: current branch (`git branch --show-current`)
   - `prompt`: a short failure report — the problem detected (diagnostic text), the repo/workspace, the failing operation, and the ask (diagnose the failure, identify root cause, and propose the fix; do not create a PR)
   - `autoApprove: false`, `autoCreatePR: false` (diagnosis / manage, not code submission)
3. **Register** the new session so the monitor keeps tracking it:
   ```bash
   ~/.config/opencode/scripts/jules_monitor.sh add <session-id> "$PWD"
   ```
4. **Monitor** it per the standard procedure (report `AWAITING_USER_FEEDBACK`, `FAILED`, `COMPLETED`, and `STUCK>=15m`).

Throttle: one jules diagnostic session per distinct failure — do not re-spawn for the same failure on every turn. If jules is unavailable, log the failure locally and move on.

### Exact `jules_create_session` call

Use this template verbatim when routing a failure (fill the `<>` placeholders from the detected problem). Values shown are for the local opencode fork:

```jsonc
// tool: jules_create_session
{
  "repoOwner": "BrandonRaeder",
  "repoName": "TeamOptiOpencode3",
  "branch": "<current branch, e.g. revert-pr4>",
  "title": "Diagnose: <short summary of the failure>",
  "prompt": "Diagnose a failure in the local opencode fork (BrandonRaeder/TeamOptiOpencode3).\n\nWorkspace: /home/team/Programming/opencode (branch: <current branch>)\n\nProblem detected: <the +log / Step.Failed diagnostic text>\n\nFailing operation: <what was running when it failed, e.g. provider stream, tool X>\n\nAsk:\n- Identify the root cause of this failure.\n- Propose a concrete fix and where it belongs.\n- Do NOT create a pull request or change code on your own; this is diagnosis only.\n- Report your findings and next steps back.",
  "autoApprove": false,
  "autoCreatePR": false
}
```

Then register and monitor:

```bash
~/.config/opencode/scripts/jules_monitor.sh add <returned-session-id> "$PWD"
~/.config/opencode/scripts/jules_monitor.sh list "$PWD"
```