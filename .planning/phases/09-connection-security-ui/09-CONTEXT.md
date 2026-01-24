# Phase 9: Connection Security UI - Context

**Gathered:** 2026-01-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Visual indicator showing users whether their connection is secure (HTTPS), insecure (HTTP), or local. The indicator is visible at a glance in the header/titlebar without user action. Clicking reveals security details.

</domain>

<decisions>
## Implementation Decisions

### Badge placement & style
- Located in header/titlebar near the username indicator
- Lock icon only (no text), with descriptive hover tooltip for accessibility
- Green lock for HTTPS, red warning icon for HTTP
- Clickable — reveals security details (protocol info, connection status)

### HTTP warning behavior
- Badge in titlebar + dismissable banner on first visit
- Banner text is detailed: "Your connection is not encrypted..." with explanation of risk
- Banner dismissal persists via localStorage
- Badge remains red/warning color even after banner dismissal (constant visual reminder)

### State transitions
- Neutral/gray badge shown while security status is being determined
- Subtle animation (fade/color shift) when state changes
- Re-check security status on visibility change (tab becomes visible)

### Local connection handling
- Special "local" indicator distinct from secure/insecure
- Blue/neutral color with home icon
- Applies to: localhost, 127.0.0.1, ::1, *.localhost
- Clickable — explains why local connections don't need HTTPS

### Claude's Discretion
- Exact tooltip/popup design for security details
- Transition animation implementation
- Warning banner copy refinement

</decisions>

<specifics>
## Specific Ideas

- Three distinct states: Secure (green lock), Insecure (red warning), Local (blue home)
- Accessibility-first approach with descriptive tooltips
- Banner explains risk, doesn't just state "insecure"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-connection-security-ui*
*Context gathered: 2026-01-24*
