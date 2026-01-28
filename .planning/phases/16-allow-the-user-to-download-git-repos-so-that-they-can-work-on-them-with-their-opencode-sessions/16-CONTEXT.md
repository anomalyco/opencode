# Phase 16: Allow the user to download git repos so that they can work on them with their opencode sessions - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate the Ralphcity UI clone workflow into the opencode web UI so users can clone/download repos for use in their opencode sessions. This phase focuses on front-end workflow and expected behaviors, not unrelated features.

</domain>

<decisions>
## Implementation Decisions

### Repo source + selection

- Support both clone-by-URL and choosing existing local repos, matching Ralphcity UI behavior.
- Selection UI and auth handling should mimic Ralphcity UI as closely as possible.
- Clone destination defaults to a configurable workspace root.

### Download target state

- Default branch is the download/clone target, with the ability to change branches later.
- Branch switching should be supported both before download in a dialog and after in repo settings.
- Include the full `.git` directory (full git clone).
- If working tree has uncommitted changes, warn and let the user choose.
- Include submodule contents.

### Delivery + format

- Use the Ralphcity clone workflow semantics (git clone-style), not a separate archive format.
- Show progress during clone/download.
- No explicit size limits.

### Access control + limits

- Any authenticated user with project access can download/clone.
- Audit logging is required for download/clone actions (who/when/what).
- No rate limits.
- No sensitive-data warnings before download.

### Claude's Discretion

- Exact UI copy/microcopy and error state presentation.
- Specific progress indicator visuals (as long as they align with Ralphcity UI patterns).

</decisions>

<specifics>
## Specific Ideas

- "Refer to the UI in ralphcity-ui" and "mimic the front end UI as close as possible."
- Download should be implemented as full git clone behavior.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 16-allow-the-user-to-download-git-repos-so-that-they-can-work-on-them-with-their-opencode-sessions_
_Context gathered: 2026-01-27_
