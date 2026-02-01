# Phase 19: Refactor auth login page - Research

**Researched:** 2026-01-31  
**Domain:** SolidJS app stack alignment for auth UI  
**Confidence:** MEDIUM

## Summary

The current login page is rendered from a large template literal inside `packages/opencode/src/server/routes/auth.ts`. The goal is to preserve visual and behavior parity while replacing the string template with a UI built using the existing `packages/app` SolidJS stack (Vite + Tailwind + @opencode-ai/ui). The architectural change is to move markup/behavior into Solid components within `packages/app` and have the server serve a built asset for `/auth/login`, while keeping the same server-side security context, request flow, and UI behavior (2FA redirects, HTTP warning, remember-me defaults).

**Primary recommendation:** Implement the login page as a Solid entry inside `packages/app` (no new dependencies), then serve the built HTML/JS from the auth route instead of constructing it as a template string. Preserve existing inline behavior in Solid (form validation, 2FA redirects, HTTP warning dismissal, and HTTPS block state).

## Standard Stack

The established libraries/tools for this domain:

### Core

| Library           | Version | Purpose      | Why Standard                              |
| ----------------- | ------- | ------------ | ----------------------------------------- |
| `solid-js`        | catalog | UI rendering | Existing app framework in `packages/app`  |
| `@solidjs/router` | catalog | Routing      | Existing app routing library              |
| `tailwindcss`     | catalog | Styling      | Existing styling system in `packages/app` |

### Supporting

| Library            | Version   | Purpose                 | When to Use                                |
| ------------------ | --------- | ----------------------- | ------------------------------------------ |
| `@opencode-ai/ui`  | workspace | UI primitives and theme | Match existing UI styles and tokens        |
| `@opencode-ai/sdk` | workspace | Server API calls        | Use existing API client patterns if needed |

### Alternatives Considered

| Instead of        | Could Use            | Tradeoff                                                                   |
| ----------------- | -------------------- | -------------------------------------------------------------------------- |
| Solid login entry | Hono JSX on server   | Conflicts with stack alignment and adds server-side JSX configuration work |
| Solid login entry | Keep string template | Harder to maintain, no component reuse                                     |

## Architecture Patterns

### Recommended Project Structure

```
packages/app/src/
├── login/               # new login entry
│   ├── index.tsx        # Solid login app
│   ├── login.css        # login-specific styles if needed
│   └── types.ts         # shared types/constants
└── entry.tsx            # existing app entry (unchanged)
```

### Pattern 1: Solid login entry (Vite multi-page)

**What:** Add a new Vite entry HTML + Solid root for `/auth/login` that mirrors the existing UI.  
**When to use:** When replacing string HTML with a real UI using the existing app stack.  
**Notes:** Use the same styles and behavior as the current template (CSRF header, remember-me default, 2FA redirects, HTTP warning dismissal).

### Anti-Patterns to Avoid

- **Introducing React or Hono JSX for the login UI:** The agreed stack is SolidJS; avoid new dependencies or JSX runtimes.
- **Removing HTTP warning logic:** The UI must preserve the `shouldWarn`/`shouldBlock` behavior from `getConnectionSecurityInfo`.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem               | Don't Build                    | Use Instead                         | Why                                        |
| --------------------- | ------------------------------ | ----------------------------------- | ------------------------------------------ |
| Login UI rendering    | String concatenation templates | Solid login entry in `packages/app` | Maintainable and consistent with app stack |
| Form state/validation | Manual DOM mutation            | Solid signals + bindings            | Simpler state flow, fewer edge cases       |

**Key insight:** The app stack already provides Solid + Tailwind; reuse it instead of keeping a large HTML template.

## Common Pitfalls

### Pitfall 1: Mismatched build output paths

**What goes wrong:** The server can’t find or serve the built login asset.  
**Why it happens:** The login entry isn’t wired into Vite’s build output or the server route isn’t updated to point to the asset.  
**How to avoid:** Add a dedicated Vite entry for login and map `/auth/login` to that build output path.  
**Warning signs:** 404 on `/auth/login`, empty page, or missing JS.

### Pitfall 2: Missing CSRF header

**What goes wrong:** Login POST fails with `csrf_missing` because the UI doesn’t send `X-Requested-With`.  
**Why it happens:** The login route requires this header for basic CSRF protection.  
**How to avoid:** Preserve the existing fetch logic and header.  
**Warning signs:** 400 responses with `{ error: "csrf_missing" }`.

### Pitfall 3: Behavior drift on HTTPS warnings

**What goes wrong:** HTTP warning banner or blocking state stops matching current behavior.  
**Why it happens:** The existing UI uses sessionStorage to dismiss the warning and conditionally disables the form when HTTPS is required.  
**How to avoid:** Keep the same sessionStorage key (`http-warning-dismissed`) and form disabling rules.  
**Warning signs:** warning reappears every reload or login blocked without message.

## Code Examples

Verified patterns from existing app stack:

### Solid entry render

```tsx
import { render } from "solid-js/web"

const root = document.getElementById("root")
render(() => <LoginApp />, root!)
```

## State of the Art

| Old Approach                                      | Current Approach                            | When Changed | Impact                                              |
| ------------------------------------------------- | ------------------------------------------- | ------------ | --------------------------------------------------- |
| String template literal (`generateLoginPageHtml`) | Hono JSX components rendered via `c.html()` | This phase   | Easier maintenance, component reuse, safer escaping |

**Deprecated/outdated:**

- Large template literals for HTML + inline JS (hard to maintain and update).

## Open Questions

None — use the existing login template output as the parity reference, implemented in Solid.

## Sources

### Primary (HIGH confidence)

- `packages/app/src/entry.tsx` and `packages/app/src/app.tsx` (Solid app entry patterns)

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - Hono docs and repo dependencies
- Architecture: MEDIUM - Hono JSX is clear, but parity target ambiguity remains
- Pitfalls: MEDIUM - derived from existing auth flow and tsconfig constraints

**Research date:** 2026-01-31  
**Valid until:** 2026-02-28
