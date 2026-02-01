# Phase 19: Refactor auth login page - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the string-based login HTML with a proper SolidJS-based login page in `packages/opencode/src/server/routes/auth.ts`.

</domain>

<decisions>
## Implementation Decisions

### Visual/layout direction

- Match the current login page exactly; no visual redesign.
- Use a minimal, standalone login layout (no app shell), matching the current login page chrome.
- Ensure the page remains mobile responsive.
- Branding and visuals must match the current login design.

### Technology alignment

- Use the existing web stack from `packages/app` (SolidJS + Vite + Tailwind/@opencode-ai/ui patterns); avoid introducing new packages or dependencies.

### Claude's Discretion

- Component structure and CSS organization needed to mirror the existing login page.

</decisions>

<specifics>
## Specific Ideas

- The current web UI lives in `packages/app`; use it as the reference implementation and keep the login UI within the `packages/app` package while the server serves it.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 19-refactor-auth-login-page_
_Context gathered: 2026-01-31_
