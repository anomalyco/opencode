# @opencode/core

Core runtime services for OpenCode.

### Tool input repair

`tool.execute.before` hooks run in registration order. The built-in input repair hook applies the selected tool's schema at its place in that order. For example, a later hook sees `{ count: 2 }` for an integer field supplied as `"2"`. It can inspect or edit that input, or reject the call before the handler runs.

When a hook changes the tool name, Core prepares the arguments for the newly selected visible tool before calling the next hook. A name-only redirect uses the original arguments, so freeform text moves to the new tool's required string field. If a hook also edits the input, the edited value supplies the new arguments. Once repair has run, edits that keep the same tool go directly to validation.

Inside Code Mode, scripts call catalog paths, such as `tools.msg["send-text"](text)`. A hook can redirect a call using either `msg.send-text` or its registration ID, `msg_send-text`. In a scheduled check the target must also be on the check's allowlist. Leaving an unknown path unchanged preserves the usual lookup error and suggestions.
