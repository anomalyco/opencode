# Phase 6: Login UI - Research

**Researched:** 2026-01-22
**Domain:** Web UI development with SolidJS
**Confidence:** HIGH

## Summary

Phase 6 requires building a standalone login page at `/login` using the existing opencode console infrastructure. The codebase uses **SolidJS** with **@solidjs/start** for routing, **Kobalte** for accessible components, and custom CSS with CSS variables for theming.

Key findings:

- Existing UI component library (`@opencode-ai/ui`) provides reusable components (TextField, Button, Card, Checkbox, Logo)
- Backend auth endpoint (`POST /auth/login`) expects JSON with username/password and `X-Requested-With: XMLHttpRequest` header for CSRF protection
- CSS uses CSS variables with automatic dark/light mode support via `prefers-color-scheme`
- Routing follows SolidJS Start file-based conventions (place in `packages/console/app/src/routes/`)

**Primary recommendation:** Create a new route at `packages/console/app/src/routes/login.tsx` using existing UI components and styling patterns. Implement form submission with native fetch to `/auth/login`, leveraging the TextField component for inputs and Card component for the centered container.

## Standard Stack

The established libraries/tools for this domain:

### Core

| Library         | Version | Purpose               | Why Standard                 |
| --------------- | ------- | --------------------- | ---------------------------- |
| SolidJS         | catalog | Reactive UI framework | Project's frontend framework |
| @solidjs/start  | catalog | SSR and routing       | Project's meta-framework     |
| @solidjs/router | catalog | Client-side routing   | Official SolidJS router      |
| @solidjs/meta   | catalog | Head management       | Official SolidJS meta tags   |

### Supporting

| Library       | Version | Purpose               | When to Use                    |
| ------------- | ------- | --------------------- | ------------------------------ |
| @kobalte/core | catalog | Accessible primitives | Base for all UI components     |
| TypeScript    | catalog | Type safety           | All project code is TypeScript |
| Vite          | catalog | Build tool            | Used by SolidJS Start          |

### Alternatives Considered

| Instead of              | Could Use           | Tradeoff                                                                                       |
| ----------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| Native forms            | solid-forms library | Forms library adds validation abstractions but native validation simpler for single login form |
| @kobalte/core TextField | HTML input          | Kobalte provides accessibility out-of-box, consistent with existing components                 |

**Installation:**
Not needed - all dependencies already in workspace

## Architecture Patterns

### Recommended Project Structure

```
packages/console/app/src/routes/
├── login.tsx            # Login page component
└── login.css            # Login-specific styles (optional, can inline in component CSS)
```

### Pattern 1: SolidJS Start File-Based Routing

**What:** Routes are created by adding `.tsx` files to `src/routes/` directory
**When to use:** All new pages in the console app
**Example:**

```typescript
// packages/console/app/src/routes/login.tsx
import { Title, Meta } from "@solidjs/meta"

export default function Login() {
  return (
    <main data-page="login">
      <Title>Login - opencode</Title>
      <Meta name="description" content="Login to opencode" />
      {/* page content */}
    </main>
  )
}
```

### Pattern 2: Kobalte Component Usage

**What:** Import and compose accessible components from @kobalte/core or @opencode-ai/ui
**When to use:** All form inputs, buttons, interactive elements
**Example:**

```typescript
// From existing codebase: packages/ui/src/components/text-field.tsx
import { TextField } from "@opencode-ai/ui/text-field"

<TextField
  name="username"
  label="Username"
  type="text"
  required
  autoComplete="username"
/>
```

### Pattern 3: CSS Variable Theming

**What:** Use predefined CSS variables from `packages/ui/src/styles/theme.css` for colors, spacing
**When to use:** All styling to ensure dark/light mode compatibility
**Example:**

```css
/* From theme.css - automatic dark mode with prefers-color-scheme */
.login-card {
  background: var(--background-strong);
  border: 1px solid var(--border-base);
  color: var(--text-base);
}
```

### Pattern 4: Form Submission with Fetch

**What:** Use native fetch with async/await for API calls
**When to use:** Form submissions to backend
**Example:**

```typescript
// From auth route tests: expects X-Requested-With header
const handleSubmit = async (e: Event) => {
  e.preventDefault()
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({ username, password }),
  })
  if (res.ok) {
    window.location.href = "/"
  } else {
    const data = await res.json()
    setError(data.message || "Authentication failed")
  }
}
```

### Anti-Patterns to Avoid

- **Using div/span for buttons:** Screen readers won't recognize interactive elements. Always use semantic `<button>` elements
- **Hardcoded colors:** Use CSS variables instead to ensure dark/light mode works
- **Inline event handlers in JSX:** Define handlers as functions for better readability and type safety
- **Forgetting X-Requested-With header:** Backend requires this for CSRF protection, requests will fail with 400

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem                    | Don't Build                | Use Instead                          | Why                                                                  |
| -------------------------- | -------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| Text input with label      | Raw HTML input             | @opencode-ai/ui TextField            | Handles accessibility, error states, label positioning automatically |
| Password visibility toggle | Custom show/hide           | TextField with button in wrapper     | Needs proper aria-pressed, keyboard support, proper sizing           |
| Dark/light mode            | JavaScript theme switching | CSS variables + prefers-color-scheme | Already configured, automatic detection                              |
| Card container             | Custom styled div          | @opencode-ai/ui Card                 | Consistent styling with rest of app                                  |
| Logo display               | Inline SVG                 | @opencode-ai/ui Logo                 | Branded, maintained, matches other pages                             |
| Button styling             | Custom CSS                 | @opencode-ai/ui Button               | Consistent hover states, sizing, variants                            |

**Key insight:** The existing UI component library already provides accessible, themed components. Building custom equivalents would duplicate work and risk accessibility issues.

## Common Pitfalls

### Pitfall 1: Missing CSRF Header

**What goes wrong:** Requests to `/auth/login` fail with 400 error "csrf_missing"
**Why it happens:** Backend expects `X-Requested-With: XMLHttpRequest` header for basic CSRF protection
**How to avoid:** Always include header in fetch requests
**Warning signs:** Console shows 400 errors, response body has `error: "csrf_missing"`

### Pitfall 2: Password Toggle Not Accessible

**What goes wrong:** Screen reader users can't tell if password is visible, keyboard users can't toggle
**Why it happens:** Using `<div>` with onClick instead of `<button>`, missing aria-pressed attribute
**How to avoid:** Use semantic `<button>` with `role="switch"` or `aria-pressed` attribute
**Warning signs:** Can't tab to toggle button, screen reader doesn't announce state

### Pitfall 3: Hardcoded Colors Break Dark Mode

**What goes wrong:** Login form looks wrong in dark mode or doesn't respect system preference
**Why it happens:** Using hardcoded hex colors instead of CSS variables
**How to avoid:** Only use CSS variables from `theme.css` (e.g., `var(--text-base)`)
**Warning signs:** Text invisible in dark mode, colors don't match rest of app

### Pitfall 4: Form Not Keyboard Accessible

**What goes wrong:** Users can't submit form with Enter key from password field
**Why it happens:** Using click handlers on buttons instead of form onSubmit
**How to avoid:** Wrap inputs in `<form>` with `onSubmit` handler, use `type="submit"` button
**Warning signs:** Pressing Enter doesn't submit form

### Pitfall 5: Missing Autofocus and Autocomplete

**What goes wrong:** Poor UX - users must manually click username field, password managers don't work
**Why it happens:** Forgetting HTML attributes for native browser features
**How to avoid:** Add `autofocus` to username field, `autoComplete="username"` and `autoComplete="current-password"` to respective fields
**Warning signs:** Focus doesn't start in username field, browser doesn't offer to save password

## Code Examples

Verified patterns from official sources:

### Login Page Structure

```typescript
// packages/console/app/src/routes/login.tsx
import { Title, Meta } from "@solidjs/meta"
import { createSignal } from "solid-js"
import { Logo } from "@opencode-ai/ui/logo"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import { Checkbox } from "@opencode-ai/ui/checkbox"

export default function Login() {
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [rememberMe, setRememberMe] = createSignal(false)
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          username: username(),
          password: password(),
        }),
      })

      if (res.ok) {
        window.location.href = "/"
      } else {
        const data = await res.json()
        setError(data.message || "Authentication failed")
      }
    } catch (err) {
      setError("Connection error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main data-page="login">
      <Title>Login - opencode</Title>
      <Meta name="description" content="Login to opencode" />

      <div class="login-container">
        <Logo class="login-logo" />

        <Card class="login-card">
          <form onSubmit={handleSubmit}>
            <TextField
              name="username"
              label="Username"
              type="text"
              value={username()}
              onChange={setUsername}
              required
              autoComplete="username"
              autofocus
            />

            <TextField
              name="password"
              label="Password"
              type="password"
              value={password()}
              onChange={setPassword}
              required
              autoComplete="current-password"
            />

            {error() && <div class="error-message">{error()}</div>}

            <Checkbox
              checked={rememberMe()}
              onChange={setRememberMe}
            >
              Remember me
            </Checkbox>

            <Button
              type="submit"
              variant="primary"
              disabled={loading()}
            >
              {loading() ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  )
}
```

### Password Visibility Toggle (If Not Using TextField)

```typescript
// Accessible password toggle button
import { createSignal } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"

function PasswordField() {
  const [visible, setVisible] = createSignal(false)

  return (
    <div class="password-field-wrapper">
      <input
        type={visible() ? "text" : "password"}
        name="password"
        aria-label="Password"
      />
      <IconButton
        icon="eye"
        aria-pressed={visible()}
        aria-label={visible() ? "Hide password" : "Show password"}
        onClick={() => setVisible(!visible())}
      />
    </div>
  )
}
```

### CSS Styling with Theme Variables

```css
/* login.css or inline styles */
.login-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--background-base);
  padding: var(--spacing);
}

.login-logo {
  width: 200px;
  height: auto;
  margin-bottom: calc(var(--spacing) * 4);
}

.login-card {
  width: 100%;
  max-width: 360px;
  padding: calc(var(--spacing) * 8);
}

.login-card form {
  display: flex;
  flex-direction: column;
  gap: calc(var(--spacing) * 4);
}

.error-message {
  color: var(--text-critical-base);
  font-size: var(--font-size-small);
  padding: calc(var(--spacing) * 2);
  background: var(--surface-critical-weak);
  border-radius: var(--radius-md);
}

/* Responsive design */
@media (max-width: 640px) {
  .login-card {
    max-width: 100%;
    padding: calc(var(--spacing) * 4);
  }
}
```

## State of the Art

| Old Approach         | Current Approach                 | When Changed      | Impact                                       |
| -------------------- | -------------------------------- | ----------------- | -------------------------------------------- |
| React                | SolidJS                          | Project inception | Finer-grained reactivity, better performance |
| Custom CSS classes   | CSS variables + data attributes  | Current codebase  | Automatic dark mode, consistent theming      |
| Tailwind CSS         | Custom CSS with utility patterns | Current codebase  | Smaller bundle, design system control        |
| Manual accessibility | Kobalte primitives               | Current codebase  | WCAG AA compliance built-in                  |

**Deprecated/outdated:**

- Manual theme switching: Now automatic via `prefers-color-scheme` media query
- Separate dark mode stylesheets: CSS variables handle both modes in one file

## Open Questions

Things that couldn't be fully resolved:

1. **Password visibility toggle icon**
   - What we know: Icon component has "eye" icon available
   - What's unclear: Whether a second "eye-slash" or "eye-closed" icon exists for toggle state
   - Recommendation: Check icon.tsx for all available icons, may need to add new icon or use aria-pressed on single icon

2. **Form validation timing**
   - What we know: Backend validates on submit, TextField component supports error prop
   - What's unclear: Whether to show field-level errors on blur or only on submit
   - Recommendation: Show errors only after submit attempt (less intrusive), then show live validation after first attempt

3. **Remember me checkbox backend**
   - What we know: CONTEXT.md says "frontend only — backend in Phase 8"
   - What's unclear: Should checkbox be disabled/non-functional or just send but be ignored
   - Recommendation: Include checkbox in UI but don't send to backend until Phase 8 implements it

## Sources

### Primary (HIGH confidence)

- Existing codebase inspection:
  - `packages/ui/src/components/` - Component implementations
  - `packages/console/app/src/routes/` - Routing patterns
  - `packages/opencode/src/server/routes/auth.ts` - Backend API contract
  - `packages/opencode/test/server/routes/auth.test.ts` - Expected behaviors
  - `packages/ui/src/styles/theme.css` - CSS variables and theming

### Secondary (MEDIUM confidence)

- [W3C WAI Forms Tutorial](https://www.w3.org/WAI/tutorials/forms/) - Official WCAG form guidelines
- [Accessible Form Validation Guide - Smashing Magazine](https://www.smashingmagazine.com/2023/02/guide-accessible-form-validation/) - Validation patterns
- [Accessible Password Reveal Input - Make Things Accessible](https://www.makethingsaccessible.com/guides/make-an-accessible-password-reveal-input/) - Toggle button implementation

### Tertiary (LOW confidence)

- [SolidJS Form Examples](https://www.solidjs.com/examples/forms) - Official examples
- [solid-forms library](https://github.com/jorroll/solid-forms) - Alternative validation approach
- [Dos and don'ts of accessible show password buttons - Medium](https://medium.com/@web-accessibility-education/dos-and-donts-of-accessible-show-password-buttons-9a5fbc2c566b) - Toggle accessibility

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - Direct inspection of package.json and imports
- Architecture: HIGH - Verified patterns from existing routes and components
- Pitfalls: HIGH - Derived from auth tests and WCAG documentation

**Research date:** 2026-01-22
**Valid until:** 30 days (stable stack, no framework migrations expected)
