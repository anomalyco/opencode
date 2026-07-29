# ProjectCombo dual-DGX coordinator prototype

This prototype runs two persistent OpenCode sessions against the configured
local providers:

- `Mark1` on DGX Spark 1: sole writer, builder, and runtime verifier.
- `Spencer2` on DGX Spark 2: read-only investigator and reviewer.

The initial investigation and implementation run concurrently. The coordinator
then resumes the same sessions for bounded evidence-based review/fix rounds.
Artifacts are written under
`F:\ProjectCombo_Builds\ProjectKnowledge\AgentExchange\<timestamp>`.

Run `Start ProjectCombo Team.cmd`, enter one mission, and leave the window open.
This is an external proof-of-behavior while the equivalent lifecycle and
messaging are ported into OpenCode's current V2 session architecture.

Based conceptually on the Agent Teams design discussed in anomalyco/opencode
issue #12711 and PRs #12730-#12732. This implementation uses the supported
OpenCode 1.18.9 CLI session/resume interface and does not copy the older session
integration code.
