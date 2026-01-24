# Phase 9: Connection Security UI - Research

**Researched:** 2026-01-24
**Domain:** Web security status indicator UI with SolidJS
**Confidence:** HIGH

## Summary

Phase 9 implements a visual security indicator badge that shows users whether their connection is secure (HTTPS), insecure (HTTP), or local (localhost/127.0.0.1). The badge appears in the titlebar without user action and is clickable to reveal security details. This phase builds on the existing authentication UI (Phase 6) and security hardening (Phase 7) by providing transparent security status to users.

The standard approach uses browser's built-in `window.location.protocol` API to detect HTTPS vs HTTP, with special handling for localhost connections which browsers treat as "potentially trustworthy" even without HTTPS. The UI follows WCAG 2.2 accessibility standards with color + icon + text patterns to avoid color-only distinction, and uses the existing Kobalte component library for accessible tooltips/popovers.

**Primary recommendation:** Use icon-only badge with tooltip for space efficiency, Kobalte Popover for clickable security details, and localStorage for dismissible HTTP warning banner persistence. Prioritize accessibility with color + icon combination and visible text in tooltips.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @kobalte/core | 0.13.11 | Accessible UI primitives | Already in project; provides WCAG-compliant Tooltip and Popover components with screen reader support |
| SolidJS | 1.9.10 | Reactive UI framework | Project framework; efficient reactivity for state changes |
| Tailwind CSS | 4.1.11 | Utility-first styling | Project styling system; rapid UI development |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @solid-primitives/storage | 4.3.3 | Reactive localStorage | Already in project; for persisting banner dismissal state |
| Page Visibility API | Browser built-in | Tab visibility detection | For re-checking security status when tab becomes visible |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Kobalte Popover | Custom modal | Custom modal requires reimplementing accessibility features (focus trap, keyboard nav, ARIA) |
| localStorage | Session storage | Session storage doesn't persist across browser sessions; banner would reappear unnecessarily |
| Browser API | Server-side detection | Server can't detect client's actual connection protocol in all deployment scenarios |

**Installation:**
No new packages required - all dependencies already in project.

## Architecture Patterns

### Recommended Project Structure
```
packages/app/src/components/
├── security-indicator.tsx       # Main badge component
├── security-details-popover.tsx # Clickable popover with details
└── security-warning-banner.tsx  # Dismissible HTTP warning banner
```

### Pattern 1: Browser Security Detection
**What:** Use browser's native API to detect connection protocol and identify localhost.
**When to use:** On component mount and when page visibility changes.
**Example:**
```typescript
// Source: MDN Location.protocol documentation
function getSecurityStatus() {
  const protocol = window.location.protocol; // Returns "https:" or "http:"
  const hostname = window.location.hostname;

  // Check for local connection
  const isLocal = hostname === "localhost" ||
                  hostname === "127.0.0.1" ||
                  hostname === "::1" ||
                  hostname.endsWith(".localhost");

  if (isLocal) {
    return "local";
  }

  return protocol === "https:" ? "secure" : "insecure";
}
```

### Pattern 2: State-Driven Badge Component
**What:** Reactive component that updates based on security status with color-coded icons.
**When to use:** For displaying security status in titlebar.
**Example:**
```typescript
// Source: Existing project patterns (session-mcp-indicator.tsx)
import { createMemo } from "solid-js";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";

export function SecurityIndicator() {
  const status = createMemo(() => getSecurityStatus());

  return (
    <Button
      variant="ghost"
      onClick={showSecurityDetails}
      aria-label={`Connection is ${status()}`}
    >
      <Icon
        name={status() === "secure" ? "lock" : status() === "local" ? "home" : "alert-triangle"}
        classList={{
          "text-icon-success-base": status() === "secure",
          "text-icon-info-base": status() === "local",
          "text-icon-critical-base": status() === "insecure"
        }}
      />
    </Button>
  );
}
```

### Pattern 3: Accessible Tooltip with Kobalte
**What:** Use Kobalte Tooltip for hover-based descriptive text.
**When to use:** For providing quick status information without clicking.
**Example:**
```typescript
// Source: Kobalte documentation
import { Tooltip } from "@kobalte/core";

<Tooltip>
  <Tooltip.Trigger as={Button} variant="ghost">
    <Icon name="lock" />
  </Tooltip.Trigger>
  <Tooltip.Portal>
    <Tooltip.Content>
      <Tooltip.Arrow />
      Connection is secure (HTTPS)
    </Tooltip.Content>
  </Tooltip.Portal>
</Tooltip>
```

### Pattern 4: Clickable Popover for Details
**What:** Use Kobalte Popover for detailed security information on click.
**When to use:** For revealing full security context (protocol, explanation).
**Example:**
```typescript
// Source: Kobalte documentation
import { Popover } from "@kobalte/core";
import { createSignal } from "solid-js";

export function SecurityDetailsPopover() {
  const [open, setOpen] = createSignal(false);
  const status = createMemo(() => getSecurityStatus());

  return (
    <Popover open={open()} onOpenChange={setOpen}>
      <Popover.Trigger>{/* Badge */}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content>
          <Popover.Arrow />
          <Popover.Title>Connection Security</Popover.Title>
          <Popover.Description>
            Protocol: {window.location.protocol}
            {status() === "secure" && "Your connection is encrypted with HTTPS."}
            {status() === "insecure" && "Your connection is not encrypted."}
            {status() === "local" && "This is a local development connection."}
          </Popover.Description>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
```

### Pattern 5: Dismissible Banner with localStorage
**What:** Warning banner that can be dismissed and remembers dismissal state.
**When to use:** For first-time HTTP connection warnings.
**Example:**
```typescript
// Source: Medium article on dismissible banners with localStorage
import { createSignal, onMount, Show } from "solid-js";

export function SecurityWarningBanner() {
  const [dismissed, setDismissed] = createSignal(false);
  const status = createMemo(() => getSecurityStatus());

  onMount(() => {
    const isDismissed = localStorage.getItem("security-warning-dismissed");
    setDismissed(isDismissed === "true");
  });

  const handleDismiss = () => {
    localStorage.setItem("security-warning-dismissed", "true");
    setDismissed(true);
  };

  return (
    <Show when={status() === "insecure" && !dismissed()}>
      <div role="alert" class="bg-surface-critical-base p-4">
        <p>Your connection is not encrypted. Data sent over HTTP can be intercepted.</p>
        <button onClick={handleDismiss} aria-label="Dismiss warning">
          Dismiss
        </button>
      </div>
    </Show>
  );
}
```

### Pattern 6: Visibility Change Re-Check
**What:** Re-check security status when tab becomes visible.
**When to use:** To catch proxy/connection changes while tab was inactive.
**Example:**
```typescript
// Source: MDN Page Visibility API
import { onMount, onCleanup } from "solid-js";

export function SecurityIndicator() {
  const [status, setStatus] = createSignal(getSecurityStatus());

  onMount(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setStatus(getSecurityStatus());
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    onCleanup(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  });

  return (/* badge UI */);
}
```

### Pattern 7: Transition Animation
**What:** Subtle fade/color transition when security state changes.
**When to use:** To draw attention to state changes without being jarring.
**Example:**
```typescript
// Source: CSS Tricks transitions guide
// In CSS:
.security-badge {
  transition: color 0.3s ease, background-color 0.3s ease;
}

// In component:
<div
  class="security-badge"
  classList={{
    "text-icon-success-base": status() === "secure",
    "text-icon-critical-base": status() === "insecure"
  }}
>
  {/* icon */}
</div>
```

### Anti-Patterns to Avoid
- **Color-only distinction:** WCAG 1.4.1 violation - must use icon + color + tooltip text together, not just red/green colors alone
- **Auto-dismissing warnings:** Security warnings should require user action to dismiss, not auto-hide after timeout
- **Blocking modal on HTTP:** Don't prevent app usage with intrusive modal; use non-blocking banner + persistent badge instead
- **SVG aria-label on buttons:** Use visually-hidden text or visible text with decorative icon (aria-hidden="true") instead

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accessible tooltip | Custom position logic + ARIA | Kobalte Tooltip | Handles keyboard navigation, screen reader announcements, focus management, positioning edge cases |
| Accessible popover | Custom modal/dropdown | Kobalte Popover | WAI-ARIA compliant, manages focus trap, Escape key handling, outside click detection |
| localStorage reactivity | Manual get/set + listeners | @solid-primitives/storage | Reactive updates across components, SSR-safe, type-safe |
| Visibility detection | setInterval polling | Page Visibility API | Battery-efficient, browser-native, fires on actual visibility changes |
| Color contrast | Manual color picking | WCAG checker tools | Ensures 4.5:1 minimum ratio, catches accessibility issues |

**Key insight:** Accessibility in UI components is complex - proper ARIA roles, keyboard navigation, focus management, and screen reader announcements require extensive testing. Kobalte components are battle-tested and WCAG 2.2 compliant.

## Common Pitfalls

### Pitfall 1: Color-Only Status Indication
**What goes wrong:** Using only red for HTTP and green for HTTPS violates WCAG 1.4.1 and fails for colorblind users (5% of population).
**Why it happens:** Developers assume color alone is sufficient; red/green has cultural "stop/go" meaning.
**How to avoid:** Always combine color with icon shape AND text (via tooltip). Use distinct icon shapes: lock (secure), triangle/shield with exclamation (insecure), house (local).
**Warning signs:** Only classList changing colors without icon or text changes; no aria-label or tooltip.

### Pitfall 2: Blocking Users on HTTP
**What goes wrong:** Displaying modal that prevents app usage on HTTP connections frustrates users with legitimate reasons (dev environments, internal networks).
**Why it happens:** Over-zealous security concern; misunderstanding of threat model.
**How to avoid:** Use dismissible banner + persistent badge instead. Let users make informed choice.
**Warning signs:** Modal with no dismiss option; app unusable until HTTPS.

### Pitfall 3: Missing Localhost Detection
**What goes wrong:** Showing "insecure" warning for localhost development, causing alert fatigue.
**Why it happens:** Only checking protocol, not hostname; unaware that browsers treat localhost as "potentially trustworthy".
**How to avoid:** Explicitly check for localhost, 127.0.0.1, ::1, and *.localhost patterns. Show neutral "local" indicator instead.
**Warning signs:** HTTP warning showing during local development; developers constantly dismissing banner.

### Pitfall 4: Aria-Label on Icon Buttons
**What goes wrong:** Screen readers may not announce aria-label reliably on icon-only buttons across all browsers/assistive tech.
**Why it happens:** Common but suboptimal pattern; MDN examples use it.
**How to avoid:** Use visible text with icon, or visually-hidden text span with CSS (.sr-only). Keep icon decorative with aria-hidden="true".
**Warning signs:** Tooltip and aria-label duplicating same text; no visible text near icon.

### Pitfall 5: Banner State Not Persisting
**What goes wrong:** HTTP warning banner reappears every page load/refresh despite user dismissing it.
**Why it happens:** Storing dismissal in component state instead of localStorage; not implementing persistence.
**How to avoid:** Store dismissal timestamp in localStorage; check on mount. Consider session-based persistence for temporary dismissal.
**Warning signs:** Banner reappears on refresh; users complain about repetitive warnings.

### Pitfall 6: Layout Shift on Banner Appearance
**What goes wrong:** Banner sliding down pushes content, causing jarring Cumulative Layout Shift (CLS) - bad for Core Web Vitals.
**Why it happens:** Banner injected into flow without reserved space; animation shifts adjacent elements.
**How to avoid:** Reserve space with min-height, or use fixed/sticky positioning above content flow. Animate opacity/transform, not height.
**Warning signs:** Page content jumps when banner appears; poor Lighthouse CLS score.

### Pitfall 7: Not Re-Checking on Visibility Change
**What goes wrong:** Security status becomes stale when user switches tabs, potentially missing proxy injection or connection changes.
**Why it happens:** Checking security only on mount; not monitoring page lifecycle.
**How to avoid:** Add visibilitychange event listener to re-check when tab becomes active.
**Warning signs:** Status doesn't update when switching networks; stale protocol indication.

## Code Examples

Verified patterns from official sources:

### Detecting HTTPS/HTTP/Local
```typescript
// Source: MDN Location.protocol + MDN Secure Contexts
function getConnectionSecurity(): "secure" | "insecure" | "local" {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;

  // Check for potentially trustworthy local origins
  // Ref: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost");

  if (isLocal) {
    return "local";
  }

  // Protocol includes the colon: "https:" or "http:"
  return protocol === "https:" ? "secure" : "insecure";
}
```

### Badge with Tooltip (Accessibility Pattern)
```typescript
// Source: Kobalte Tooltip docs + project patterns
import { Tooltip } from "@kobalte/core";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";
import { createMemo } from "solid-js";

export function SecurityBadge() {
  const status = createMemo(() => getConnectionSecurity());

  const iconName = createMemo(() => {
    switch (status()) {
      case "secure": return "lock";
      case "local": return "home";
      case "insecure": return "alert-triangle";
    }
  });

  const tooltipText = createMemo(() => {
    switch (status()) {
      case "secure": return "Connection is secure (HTTPS)";
      case "local": return "Local development connection";
      case "insecure": return "Connection is not secure (HTTP)";
    }
  });

  return (
    <Tooltip openDelay={500} closeDelay={0}>
      <Tooltip.Trigger
        as={Button}
        variant="ghost"
        class="size-8 rounded-md"
        aria-label={tooltipText()}
      >
        <Icon
          name={iconName()}
          size="small"
          classList={{
            "text-icon-success-base": status() === "secure",
            "text-icon-info-base": status() === "local",
            "text-icon-critical-base": status() === "insecure"
          }}
        />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="bg-surface-base p-2 rounded shadow-lg">
          <Tooltip.Arrow />
          {tooltipText()}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip>
  );
}
```

### Dismissible Warning Banner
```typescript
// Source: Medium article on localStorage banner patterns
import { createSignal, onMount, Show } from "solid-js";
import { Button } from "@opencode-ai/ui/button";
import { Icon } from "@opencode-ai/ui/icon";

const STORAGE_KEY = "opencode:security-warning-dismissed";

export function SecurityWarningBanner() {
  const [dismissed, setDismissed] = createSignal(false);
  const status = createMemo(() => getConnectionSecurity());

  onMount(() => {
    // Check if user has dismissed warning before
    const wasDismissed = localStorage.getItem(STORAGE_KEY);
    if (wasDismissed === "true") {
      setDismissed(true);
    }
  });

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
  };

  return (
    <Show when={status() === "insecure" && !dismissed()}>
      <div
        role="alert"
        class="bg-surface-critical-base border-l-4 border-border-critical-base p-4 flex items-start justify-between gap-4"
      >
        <div class="flex items-start gap-3">
          <Icon name="alert-triangle" class="text-icon-critical-base shrink-0 mt-0.5" />
          <div>
            <h3 class="font-semibold text-text-base mb-1">
              Unsecured Connection
            </h3>
            <p class="text-text-muted text-sm">
              Your connection is not encrypted. Data sent over HTTP can be intercepted by others on the network.
              For security, use HTTPS when available.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="small"
          onClick={handleDismiss}
          aria-label="Dismiss security warning"
        >
          <Icon name="x" size="small" />
        </Button>
      </div>
    </Show>
  );
}
```

### Re-Check on Visibility Change
```typescript
// Source: MDN Page Visibility API
import { createSignal, onMount, onCleanup } from "solid-js";

export function SecurityIndicator() {
  const [status, setStatus] = createSignal(getConnectionSecurity());

  onMount(() => {
    const handleVisibilityChange = () => {
      // Only check when tab becomes visible
      if (document.visibilityState === "visible") {
        setStatus(getConnectionSecurity());
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    onCleanup(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  });

  return (/* UI */);
}
```

### Smooth Color Transition
```css
/* Source: CSS Tricks transitions + Josh Comeau animation guide */
.security-indicator {
  /* Animate color and opacity for smooth transitions */
  transition: color 0.3s ease, opacity 0.3s ease;

  /* Use transform/opacity for GPU acceleration */
  will-change: color;
}

/* For fade-in animation */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.banner-enter {
  animation: fadeIn 0.3s ease;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side protocol detection | Client-side `window.location.protocol` | Always standard | Client-side is more reliable; server may not know actual client connection in proxy scenarios |
| Modal blocking on HTTP | Non-blocking banner + badge | ~2020s UX evolution | Better UX; doesn't prevent legitimate use cases (dev, internal networks) |
| Color-only status | Color + icon + text | WCAG 2.1+ (2018) | Accessibility compliance; works for colorblind users |
| Custom tooltips | Kobalte/Radix primitives | ~2022+ component libraries | WCAG 2.2 compliance out-of-box; reduced maintenance |
| Session storage | localStorage | Persistence requirements | Banner dismissal persists across sessions as expected |

**Deprecated/outdated:**
- **Padlock in URL bar only:** Browsers moved security indicators to different locations or removed them entirely (Chrome 2021+); web apps now show their own indicators for clarity
- **Mixed content warnings in UI:** Modern browsers block mixed content by default; less need for app-level warnings
- **Green address bar:** Removed by most browsers around 2019; EV certificates no longer have special UI treatment

## Open Questions

Things that couldn't be fully resolved:

1. **Localhost variations beyond standard patterns**
   - What we know: localhost, 127.0.0.1, ::1, *.localhost are standard patterns browsers treat as potentially trustworthy
   - What's unclear: Edge cases like custom /etc/hosts entries, *.local (mDNS), or IPv6 link-local addresses
   - Recommendation: Start with standard patterns; add edge cases if users report false warnings

2. **Banner re-appearance after dismissal**
   - What we know: localStorage persists dismissal permanently until cleared
   - What's unclear: Should warning reappear after X days, on major security incidents, or never?
   - Recommendation: Permanent dismissal for now; badge remains as persistent reminder; revisit if needed

3. **Proxy/VPN detection**
   - What we know: Client-side JS cannot reliably detect proxies that upgrade HTTP to HTTPS
   - What's unclear: Should we attempt to detect and warn about potential proxy scenarios?
   - Recommendation: Don't attempt detection; rely on browser's protocol as ground truth for client experience

4. **Icon choice for "local" status**
   - What we know: Home icon is common for local/localhost concepts
   - What's unclear: Does "home" icon clearly communicate "local development" to all users?
   - Recommendation: Use home icon + clear tooltip "Local development connection"; user testing may reveal better options

## Sources

### Primary (HIGH confidence)
- [MDN Location.protocol](https://developer.mozilla.org/en-US/docs/Web/API/Location/protocol) - Browser API reference
- [MDN Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) - Localhost trustworthiness
- [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) - Tab visibility detection
- [MDN visibilitychange event](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) - Event reference
- [Kobalte Tooltip documentation](https://kobalte.dev/docs/core/components/tooltip/) - Tooltip implementation
- [Kobalte Popover documentation](https://kobalte.dev/docs/core/components/popover/) - Popover implementation
- [WebAIM Color Contrast](https://webaim.org/articles/contrast/) - WCAG contrast requirements
- [MDN Use of Color](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Perceivable/Use_of_color) - WCAG 1.4.1 guidance

### Secondary (MEDIUM confidence)
- [Cookie Banner Accessibility 2026](https://cookie-script.com/guides/web-accessibility-and-cookie-banners-compliance-checklist) - Banner accessibility standards
- [Medium: Dismissible Banner localStorage](https://medium.com/front-end-weekly/dismissible-banner-continued-storing-component-state-8e60f88e3e64) - Persistence patterns
- [Primer Banner Accessibility](https://primer.style/product/components/banner/accessibility/) - Focus management best practices
- [Sara Soueidan Accessible Icon Buttons](https://www.sarasoueidan.com/blog/accessible-icon-buttons/) - Icon accessibility patterns
- [Josh Comeau CSS Transitions](https://www.joshwcomeau.com/animation/css-transitions/) - Animation best practices
- [CSS Tricks Transitions](https://css-tricks.com/almanac/properties/t/transition/) - Transition reference
- [Web Accessibility Guidelines Icons](https://stevenmouret.github.io/web-accessibility-guidelines/techniques/accessible-icons.html) - Icon implementation patterns

### Tertiary (LOW confidence - for validation)
- [Trust Badges Guide 2026](https://payhip.com/blog/trust-badges/) - Generic trust badge UI patterns
- [Mobbin Badge UI Design](https://mobbin.com/glossary/badge) - Badge design examples
- [Oligo Security localhost bypass](https://www.oligo.security/blog/0-0-0-0-day-exploiting-localhost-apis-from-the-browser) - Recent localhost security research (2025)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Project already uses Kobalte, SolidJS, Tailwind; no new dependencies needed
- Architecture: HIGH - Browser APIs are stable; Kobalte patterns well-documented; verified with official sources
- Pitfalls: HIGH - Accessibility issues well-documented in WCAG; common mistakes identified in MDN and accessibility guides

**Research date:** 2026-01-24
**Valid until:** ~60 days (2026-03-24) - Browser APIs stable; WCAG standards stable; Kobalte updates unlikely to break patterns
