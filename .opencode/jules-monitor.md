# Jules Session Monitor

Whenever this agent session starts, always set up a Jules status monitor before doing other work:

1. Ensure `~/.config/opencode/scripts/jules_monitor.sh` exists (copy from `/home/team/Programming/Kernelopti/scripts/agents/jules_monitor.sh` if missing).
2. Ensure a cron job runs it every 5 minutes: `*/5 * * * * /home/team/.config/opencode/scripts/jules_monitor.sh`
3. Run `~/.config/opencode/scripts/jules_monitor.sh list` and register any in-flight sessions with `... add <session-id>`. Whenever you spawn a new Jules session for background work, register its ID too.
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