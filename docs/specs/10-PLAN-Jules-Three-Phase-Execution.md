# Jules integration plan (3 phases)

This is the delivery contract after docs cleanup.

## Phase 1: Stateless proxy foundation (current branch)

Goal: land the Jules REST proxy safely with full test coverage.

Included in this phase:
- Typed Jules client and schemas.
- Stateless route handlers for sessions, activities, approvals, cancel, and sources.
- Unit and live integration tests.

Exit criteria:
- CI green on branch.
- No new framework wiring required outside the Jules module.
- PR ready for focused core review.

## Phase 2: Session-scoped SSE branch (issue #9650 assimilation)

Goal: implement server-side session filtering support from
`https://github.com/anomalyco/opencode/issues/9650` in a dedicated branch,
then assimilate upstream behavior once the core change is accepted.

Working rules:
- Build phase 2 as an isolated branch so the core delta stays reviewable.
- Track upstream issue semantics exactly (`/event?sessionID=` filtering).
- Keep the Jules event contract compatible with current bus and SSE surfaces.

Exit criteria:
- Phase 2 branch proves behavior against current core.
- Assimilation checklist is prepared for upstream merge timing.
- No blocking dependency leaks back into phase 1.

## Phase 3: Final integration hardening

Goal: complete the agentic-run integration with minimal rewiring after phase 2
lands upstream.

Included in this phase:
- Bind Jules watcher/event flow to accepted phase 2 core behavior.
- Validate reconnect, timeline truth rules, and artifact/event continuity.
- Finish UX-level verification across Linux and Windows test paths.

Design constraint:
- Any rewiring must be narrow and local so the phase 1 API and tests remain
stable.

Exit criteria:
- Integration path is stable after upstream assimilation.
- Final PR update documents what changed and why.
- Follow-up work is reduced to optional enhancements, not structural fixes.
