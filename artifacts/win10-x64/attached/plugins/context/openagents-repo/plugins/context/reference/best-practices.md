<!-- Context: openagents-repo/best-practices | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# Best Practices & Limitations

## Message Injection Workarounds

**The Reality**: The message system is largely read-only. You cannot mutate messages mid-stream or inject text directly into an existing message part.

### What Doesn't Work
- Modifying `event.data.content` in `message.updated`.
- Retroactively changing AI responses.

### What Works
1. **Initial Context**: Use `session.created` to inject a starting message using `client.session.prompt()`.
2. **Prompt Decoration**: Use `client.tui.appendPrompt()` to add text to the user's input box before they hit enter.
3. **Tool Interception**: Use `tool.execute.before` to modify arguments *before* the tool runs.
4. **On-Demand Context**: Provide custom tools that the AI can call when it needs more information.

## Security

- Always validate tool inputs in `tool.execute.before`.
- Use environment variables for sensitive data; do not hardcode API keys.
- Be careful with the `$` shell API to prevent command injection.

## Performance

- Avoid heavy synchronous operations in event handlers as they can block the TUI.
- Use the `session.idle` event for cleanup or background sync tasks.
