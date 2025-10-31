# OpenCode 1.0

OpenCode 1.0 is a rewrite of the TUI

We went from the go+bubbletea based TUI which suffered from both performance and capability issues to an in-house
framework (OpenTUI) written in zig+solidjs.

The new TUI mostly works like the old one as it's connecting to the same
opencode server.

There are some notable UX changes:

1. The session history is more compressed, only showing the full details of the edit
   and bash tool.

2. We've added a command bar which almost everything flows through. Can press
   ctrl+p to bring it up in any context and see everything you can do.

3. Added a session sidebar (can be toggled) with some useful information.

We've also stripped out some functionality that we were not sure if anyone
actually used - if something important is missing please open an issue and we'll add it back
quickly.

### Breaking Changes

## Keybinds

### Renamed

- messages_revert -> messages_undo
- switch_agent -> agent_cycle
- switch_agent_reverse -> agent_cycle_reverse
- switch_mode -> agent_cycle
- switch_mode_reverse -> agent_cycle_reverse

### Removed

- messages_layout_toggle
- messages_next
- messages_previous
- file_diff_toggle
- file_search
- file_close
- file_list
- app_help
- project_init
- tool_details
- thinking_blocks
- session_child_cycle
- session_child_cycle_reverse
- model_cycle_recent
- model_cycle_recent_reverse
