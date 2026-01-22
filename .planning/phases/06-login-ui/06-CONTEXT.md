# Phase 6: Login UI - Context

**Gathered:** 2026-01-22
**Status:** Ready for planning

<domain>
## Phase Boundary

A polished web login form matching opencode's visual design. Users can enter username/password, see clear error messages, and authenticate. This phase covers the login form UI only — security hardening (CSRF, rate limiting) and session enhancements (remember me backend) are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Visual Style
- Match opencode's existing component library and styling (colors, fonts, buttons)
- Centered card layout for the form
- opencode logo/wordmark displayed above the login card
- Dark/light mode follows system preference
- Input field and button styles: Claude's discretion to match opencode patterns
- Form spacing: Claude's discretion based on standard UX practices

### Form Behavior
- Password field has show/hide toggle (icon style: Claude's discretion)
- Include "Remember me" checkbox (frontend only — backend in Phase 8)
- Auto-focus on username field when page loads
- Enter key submits form from password field

### Error Display
- Errors appear inline above the form (inside the card)
- Empty required fields get highlighted (red border) on submit attempt
- Error animation: Claude's discretion
- Error message styling: Claude's discretion to match opencode patterns

### Page Structure
- Full standalone page at /login (not a modal)
- Minimal footer only (version/links), no header
- Background style: Claude's discretion
- Responsive design — form adapts to mobile screens

### Claude's Discretion
- Input field style (outlined, filled, underlined)
- Button style for submit
- Form spacing and sizing
- Show/hide password icon choice
- Error animation (shake or none)
- Error message styling details
- Background treatment (solid, gradient, pattern)

</decisions>

<specifics>
## Specific Ideas

- Logo above the form establishes branding on the login page
- "Remember me" checkbox included for user convenience (actual session extension in Phase 8)
- Mobile-friendly responsive layout is required

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-login-ui*
*Context gathered: 2026-01-22*
