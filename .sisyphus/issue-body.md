### Is your feature request related to a problem?

When working with opencode on long-running agent tasks, users have no way to discuss or review the agent's progress in real-time. They must wait for the task to complete before they can comment, ask questions, or course-correct. This creates a frustrating idle period during complex operations.

### Describe the solution you'd like

A **Sidekick** feature: a lightweight, parallel chat-only conversation that runs alongside the main session. The sidekick:

- Reads the parent session's messages in real-time (snapshot at prompt time)
- Has its own independent context window (no shared context pollution)
- Cannot execute any tools (chat-only companion)
- Allows users to inject sidekick conclusions back into the parent session's context
- Appears as a sidebar tab in the TUI (no layout changes needed)

This gives users a "waiting room" experience where they can monitor, discuss, or simply chat while the main agent works.

### Describe alternatives you've considered

1. **Separate terminal session**: Users could open a second opencode instance, but it wouldn't have access to the main session's context.
2. **In-session comments**: Adding comments to the main session would pollute the agent's context window and potentially confuse the model.
3. **Read-only viewer**: A viewer without chat capability, but this doesn't allow users to discuss or annotate progress.

### Additional context

Implementation is ready as a PR. The sidekick is modeled as a child session with `kind: "sidekick"` and `parentID` pointing to the main session, with comprehensive route guards, tool blocking, and TUI integration.
