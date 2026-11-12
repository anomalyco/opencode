# @opencode/core

Core runtime services for OpenCode.

### Tool input repair

`tool.execute.before` hooks run in registration order. Each hook receives the preceding hook's edits. Core uses the final name to select a visible registration, wraps a freeform string in that tool's required string field, then applies schema coercion if the built-in input repair plugin is active. Hooks that need a repaired value can inspect the input passed to `tool.execute.after` when the selected handler runs.

Inside Code Mode, scripts call catalog paths, such as `tools.msg["send-text"](text)`. A hook can redirect a call using either `msg.send-text` or its registration ID, `msg_send-text`. In a scheduled check the target must also be on the check's allowlist. Leaving an unknown path unchanged preserves the usual lookup error and suggestions.
