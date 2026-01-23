# Phase 8: Session Enhancements - Context

**Gathered:** 2026-01-23
**Status:** Ready for planning

<domain>
## Phase Boundary

"Remember me" functionality and session activity indicator. Users can extend session lifetime via checkbox on login form, and see their logged-in username with logout access. Session refreshes silently on activity.

</domain>

<decisions>
## Implementation Decisions

### Remember me behavior
- Extended session lasts 30 days (vs default idle timeout)
- Checkbox on login form, checked by default
- Persistent cookie (survives browser restart)
- Timeout configurable in opencode.json (e.g., `rememberMeTimeout: "30d"`)

### Session indicator display
- No expiration countdown displayed (confusing UX)
- Show logged-in username in header/status bar
- Username dropdown with logout option

### Activity refresh behavior
- Any interaction refreshes session (within reason - not excessive server calls)
- Piggyback on existing API requests (no dedicated refresh endpoint)
- Silent extension when user becomes active again (before expiration)
- Completely invisible to user - no visual feedback on refresh
- Document this behavior in README

### Expiration warning
- 15 minutes before expiration
- Toast/banner notification (non-blocking)
- "Extend session" button (single action)
- If ignored and expires: "Session expired" overlay on current page with login prompt

### Claude's Discretion
- Exact toast/banner styling and position
- Throttle interval for activity-based refresh
- Session expired overlay design
- README section wording for session behavior

</decisions>

<specifics>
## Specific Ideas

- User explicitly wants remember me checkbox checked by default for convenience
- Session indicator should be minimal - just username, no time remaining
- Activity refresh should be invisible but documented so users understand the behavior
- Overlay on expiration preserves context (user can see what they were doing)

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope

</deferred>

---

*Phase: 08-session-enhancements*
*Context gathered: 2026-01-23*
