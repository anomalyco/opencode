# Subagent Task Tool

## MODIFIED Requirements

### Requirement: Background execution is the default

When `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` is enabled, the `task` tool SHALL
run a subagent in the background unless the caller explicitly passes
`background: false`.

#### Scenario: Caller omits the background parameter

- **WHEN** the experimental flag is enabled and a `task` call does not set `background`
- **THEN** the subagent SHALL run in the background (placeholder returned immediately, parent continues, result injected later)

#### Scenario: Caller explicitly requests foreground

- **WHEN** the experimental flag is enabled and a `task` call sets `background: false`
- **THEN** the subagent SHALL run in the foreground and block the calling turn until it completes

### Requirement: Flag-off callers always run in foreground

When `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` is not enabled, the `task` tool
SHALL NOT expose the `background` parameter and SHALL always run subagents in the
foreground.

#### Scenario: Experimental flag disabled

- **WHEN** the experimental flag is disabled
- **THEN** the `background` field SHALL NOT appear in the tool's parameter schema
- **AND** every `task` call SHALL run in the foreground without error
