## ADDED Requirements

### Requirement: every protocol claim is verified or explicitly marked unverified

`findings.md` SHALL state, for each protocol claim it records, whether it was verified against
the actually-installed Claude Code version or is unverified/assumed. No claim SHALL be presented
as fact without verification.

#### Scenario: an unverifiable detail is marked as such
- **WHEN** a protocol detail cannot be confirmed against the real Claude Code install
- **THEN** `findings.md` records it as unverified rather than as an established fact

### Requirement: Spike 2 has an unambiguous outcome

Spike 2 SHALL produce either a confirmed pass or a specific documented failure reason when
running unmodified stock Claude Code's `ListAgents` and `SendMessage` against a disposable
Claude-compatible opencode peer — not an ambiguous or partial result.

#### Scenario: the load-bearing spike passes
- **WHEN** the disposable peer publishes a compatible registry entry and socket
- **THEN** stock Claude Code's `ListAgents` lists it as reachable and `SendMessage` delivers to it

#### Scenario: the load-bearing spike fails cleanly
- **WHEN** the disposable peer does not appear or is not reachable
- **THEN** `findings.md` records the specific verification step that failed, with no fallback bridge protocol substituted

### Requirement: no spike code reaches the shipped product

All disposable spike code SHALL be removed or explicitly quarantined outside
`packages/opencode/src/` before this change is considered complete.

#### Scenario: the working tree is clean of spike code
- **WHEN** this change's tasks are complete
- **THEN** `git status` shows no spike code under `packages/opencode/src/`

### Requirement: research never mutates real Claude session state

All read access to real local Claude Code registry/session/socket state SHALL be read-only;
any destructive or write-path experiment SHALL use an isolated temporary
`CLAUDE_CONFIG_DIR`/`XDG_RUNTIME_DIR`, never the user's real configuration.

#### Scenario: real session files are untouched
- **WHEN** this change's research tasks are complete
- **THEN** the user's real `~/.claude/` session state is unmodified
