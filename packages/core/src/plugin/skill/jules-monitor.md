<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts. The body below becomes the skill's content.
-->

# Jules Session Monitor

Whenever an OpenCode session starts or background Jules tasks are active, set up and maintain a Jules status monitor:

1. **Verify monitor script**:
   Ensure `~/.config/opencode/scripts/jules_monitor.sh` exists and is executable (`chmod +x ~/.config/opencode/scripts/jules_monitor.sh`).

2. **Install workspace cron**:
   Ensure a workspace-scoped cron job runs it every 5 minutes (idempotent, adds `cd <workspace> && ...` per workspace):
   ```bash
   ~/.config/opencode/scripts/jules_monitor.sh install
   ```

3. **Register and list sessions**:
   ```bash
   # List tracked sessions for the current workspace:
   ~/.config/opencode/scripts/jules_monitor.sh list "$PWD"

   # Register a new session for the current workspace:
   ~/.config/opencode/scripts/jules_monitor.sh add <session-id> "$PWD"

   # Stop tracking a completed or abandoned session:
   ~/.config/opencode/scripts/jules_monitor.sh remove <session-id>
   ```

4. **Monitor status**:
   Read `~/.jules/monitor_state` and `~/.jules/jules_monitor.log`:
   - `STUCK>=15m`: Session is in `AWAITING_USER_FEEDBACK` or `FAILED` for over 15 minutes and needs attention.
   - `COMPLETED`: Work is done, check PR link.
   - Transitions: Logged when remote state advances.

## Failure routing to a Jules agent

Whenever the agent encounters a failure in this session — a `Step.Failed` error or a `+log` diagnostic part (provider error, truncated/dropped stream, inter-event stall gap, permission denial) — route it to a Jules agent for diagnosis and management.

1. **Derive the local fork repository**:
   Derive `repoOwner` and `repoName` from `git remote -v` (e.g. fork remote like `teamopti` -> `BrandonRaeder/TeamOptiOpencode3`, not upstream `anomalyco/opencode`).
2. **Spawn a diagnostic session** via `jules_create_session`:
   - `repoOwner` / `repoName`: derived repository
   - `branch`: current branch (`git branch --show-current`)
   - `prompt`: failure report with diagnostic text, failing operation, and diagnosis request (no PR creation)
   - `autoApprove: false`, `autoCreatePR: false`
3. **Register the session**:
   ```bash
   ~/.config/opencode/scripts/jules_monitor.sh add <session-id> "$PWD"
   ```
