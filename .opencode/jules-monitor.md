# Jules Session Monitor

Whenever this agent session starts, always set up a Jules status monitor before doing other work:

1. Ensure `~/.config/opencode/scripts/jules_monitor.sh` exists (copy from `/home/team/Programming/Kernelopti/scripts/agents/jules_monitor.sh` if missing).
2. Ensure a cron job runs it every 5 minutes: `*/5 * * * * /home/team/.config/opencode/scripts/jules_monitor.sh`
3. Run `~/.config/opencode/scripts/jules_monitor.sh list` and register any in-flight sessions with `... add <session-id>`. Whenever you spawn a new Jules session for background work, register its ID too.
4. Run the script once to verify it works.
5. Spawn a sub agent (task tool, `general` type) to monitor the status: read `~/.jules/monitor_state` and `~/.jules/jules_monitor.log`, report transitions, `STUCK>=15m` sessions (AWAITING_USER_FEEDBACK/FAILED needing a nudge), and `COMPLETED` sessions.

See the `jules-monitor` skill for the full procedure.