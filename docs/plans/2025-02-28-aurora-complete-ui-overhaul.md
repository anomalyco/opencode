# Aurora Complete UI Overhaul — Component-by-Component Design Spec

> **"Code illuminated from within"** — Every component redesigned from scratch.
> This is NOT a theme. This is a complete visual overhaul of the entire application.

**Date:** 2025-02-28
**Status:** Implementation Complete
**Files Changed:**
- `packages/ui/src/styles/aurora.css` — 43-section component overhaul
- `packages/app/src/index.css` — 22-section app structural overhaul
- `packages/ui/src/theme/context.tsx` — Default theme → aurora
- `packages/ui/src/theme/themes/aurora.json` — Color tokens

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Foundation Tokens](#2-foundation-tokens)
3. [Primitive Components](#3-primitive-components)
   - 3.1 Button
   - 3.2 Icon Button
   - 3.3 Card
   - 3.4 Tag
   - 3.5 Checkbox
   - 3.6 Switch
   - 3.7 Radio Group
   - 3.8 Text Field / Input
   - 3.9 Inline Input
   - 3.10 Select
   - 3.11 Progress Bar
   - 3.12 Progress Circle
   - 3.13 Spinner
   - 3.14 Keybind Badge
   - 3.15 Avatar
   - 3.16 Tooltip
   - 3.17 Toast
4. [Surface Components](#4-surface-components)
   - 4.1 Dialog / Modal
   - 4.2 Popover
   - 4.3 Dropdown Menu
   - 4.4 Context Menu
   - 4.5 Hover Card
5. [Navigation Components](#5-navigation-components)
   - 5.1 Tabs
   - 5.2 List / List Item
   - 5.3 Accordion
   - 5.4 Collapsible
   - 5.5 Message Nav
6. [Layout & Shell](#6-layout--shell)
   - 6.1 Sidebar
   - 6.2 Titlebar / Session Header
   - 6.3 Resize Handle
   - 6.4 Scrollbar
7. [Chat & Messaging](#7-chat--messaging)
   - 7.1 Prompt Dock (Hero Component)
   - 7.2 User Message
   - 7.3 Assistant Message
   - 7.4 Thinking / Reasoning Block
   - 7.5 Session Turn Container
   - 7.6 Message Part
   - 7.7 Empty State
8. [Code & Dev Tools](#8-code--dev-tools)
   - 8.1 Code Blocks (Markdown `pre`)
   - 8.2 Inline Code
   - 8.3 Diff Changes
   - 8.4 File Write/Edit/Patch Tools
   - 8.5 Basic Tool
   - 8.6 Bash Output
   - 8.7 Copy Button
   - 8.8 Permission Prompt
9. [Content & Typography](#9-content--typography)
   - 9.1 Markdown Renderer
   - 9.2 Blockquotes
   - 9.3 Ordered Lists
   - 9.4 Links
   - 9.5 Headings
10. [Branding & Media](#10-branding--media)
    - 10.1 Logo
    - 10.2 Text Shimmer
    - 10.3 File Icon
    - 10.4 Provider Icon
    - 10.5 App Icon
    - 10.6 Image Preview
    - 10.7 Session Review
11. [Animation System](#11-animation-system)
12. [App Pages](#12-app-pages)
    - 12.1 Home Page
    - 12.2 Session Page
13. [Global Effects](#13-global-effects)

---

## 1. Design Philosophy

### OLD Design (oc-1 default)
- **Flat, utilitarian** — standard dark theme with sharp borders
- **Shadows for depth** — traditional CSS box-shadows (sm, md, lg)
- **No glassmorphism** — solid opaque backgrounds
- **No glow effects** — standard hover/focus states
- **Standard radius** — `var(--radius-md)` ~8px everywhere
- **No ambient atmosphere** — plain backgrounds

### NEW Design (Aurora)
- **Digital luminescence** — elements emit light from within
- **Glass morphism everywhere** — `backdrop-filter: blur()` on surfaces, transparency layers
- **Glow system** — cyan/violet/rose/green/amber contextual glow on hover/focus/active
- **Mode-aware tokens** — dark mode emits light upward, light mode refracts it downward
- **Custom radius system** — 6px → 10px → 14px → 18px → 24px (larger, softer corners)
- **Grain texture** — subtle noise overlay on entire app for organic feel
- **Spring animations** — bounce/spring easing curves for dialogs, buttons
- **Color-coded identity** — cyan = user, violet = assistant, amber = permission, green = success, rose = error

---

## 2. Foundation Tokens

### Easing Curves
| Token | Value | Usage |
|-------|-------|-------|
| `--ease-aurora` | `cubic-bezier(0.22, 1, 0.36, 1)` | General transitions |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bouncy interactions |
| `--ease-snappy` | `cubic-bezier(0.16, 1, 0.3, 1)` | Dialog open/close |

### Border Radius Scale
| Token | Value | Usage |
|-------|-------|-------|
| `--aurora-radius-sm` | `6px` | Inline code, keybinds, small badges |
| `--aurora-radius-md` | `10px` | Buttons, inputs, tabs, tooltips |
| `--aurora-radius-lg` | `14px` | Cards, code blocks, menus, toasts |
| `--aurora-radius-xl` | `18px` | Dialogs, prompt dock |
| `--aurora-radius-2xl` | `24px` | Hero elements |
| `100px` | pill | Tags, progress bars, scrollbar thumbs |

### Glow System (Dark Mode)
| Token | Effect |
|-------|--------|
| `--glow-cyan` | `0 0 20px -5px rgba(0, 212, 255, 0.35)` |
| `--glow-cyan-hover` | `0 0 30px -5px rgba(0, 212, 255, 0.5), ring 1px` |
| `--glow-cyan-focus` | `0 0 35px -5px rgba(0, 212, 255, 0.55), ring 3px` |
| `--glow-violet` | `0 0 20px -5px rgba(167, 139, 250, 0.35)` |
| `--glow-rose` | `0 0 20px -5px rgba(255, 107, 157, 0.35)` |
| `--glow-green` | `0 0 20px -5px rgba(74, 222, 128, 0.35)` |
| `--glow-red` | `0 0 16px -5px rgba(248, 113, 113, 0.45)` |
| `--glow-amber` | `0 0 16px -5px rgba(255, 187, 51, 0.4)` |

### Glass Surfaces (Dark Mode)
| Token | Value | Usage |
|-------|-------|-------|
| `--aurora-glass` | `rgba(14, 14, 20, 0.85)` | Prompt dock, titlebar |
| `--aurora-glass-strong` | `rgba(7, 7, 16, 0.92)` | Dialogs, sidebar, menus |
| `--aurora-glass-subtle` | `rgba(20, 20, 30, 0.7)` | Hover states |

### Accent Colors
| Dark Mode | Light Mode | Role |
|-----------|------------|------|
| `#00D4FF` (cyan) | `#0891B2` (teal) | Primary accent, user identity |
| `#A78BFA` (violet) | `#7C3AED` (purple) | Secondary, assistant identity |
| `#FFBB33` (amber) | `#D97706` (amber) | Warning, permissions |
| `#FF6B9D` (rose) | `#DB2777` (pink) | Highlight, error accent |
| `#4ADE80` (green) | `#16A34A` (green) | Success |

---

## 3. Primitive Components

### 3.1 Button

**OLD:**
- `border-radius: var(--radius-md)` (~8px)
- Solid opaque backgrounds per variant (primary/ghost/secondary)
- Standard `box-shadow: var(--shadow-sm)` on primary hover
- `transition: 150ms cubic-bezier(0.4, 0, 0.2, 1)` for bg/border/shadow
- No glow, no luminescence
- Active: `transform: scale(0.97)`

**NEW (Aurora):**
- `border-radius: 10px` (--aurora-radius-md)
- **Primary:** Cyan glow halo on rest (`--glow-cyan`), intensifies on hover (`--glow-cyan-hover` with ring), focus gets 3px ring (`--glow-cyan-focus`). `translateY(-1px)` lift + `brightness(1.08)` on hover. Active: `scale(0.97)` with glow reset.
- **Secondary:** 1px border `rgba(0, 212, 255, 0.08)`, `backdrop-filter: blur(8px)` glass effect. Hover: border brightens to `rgba(0, 212, 255, 0.2)`, cyan glow appears, `translateY(-1px)`.
- **Ghost:** Transparent bg → hover fills with `rgba(0, 212, 255, 0.04)` tinted glass.
- **Large variant:** `border-radius: 14px`, `height: 36px`, `padding: 6px 16px`
- `font-weight: 500`, `letter-spacing: 0.01em` for refinement
- `transition: all 0.25s var(--ease-aurora)` (spring-like)
- All interactive buttons get `cursor: pointer` (mandated globally)

### 3.2 Icon Button

**OLD:**
- Circular or rounded square with `var(--radius-md)`
- Ghost variant: transparent, hover → `var(--surface-base-hover)`
- No glow effects

**NEW (Aurora):**
- `border-radius: 10px`
- Primary variant: same glow system as button primary
- Ghost hover: fills with `rgba(0, 212, 255, 0.04)` tinted background
- `transition: all 0.2s var(--ease-aurora)`

### 3.3 Card

**OLD:**
- `border-radius: var(--radius-lg)` (~12px)
- Solid background `var(--surface-base)` or similar
- Shadow: `var(--shadow-xs-border-base)`
- No glass, no glow on hover

**NEW (Aurora):**
- `border-radius: 14px` (--aurora-radius-lg)
- `background: rgba(255, 255, 255, 0.02)` — barely visible tint
- `backdrop-filter: blur(12px)` — glass morphism
- `border: 1px solid rgba(0, 212, 255, 0.08)` — subtle cyan-tinted border
- Hover: border brightens to `rgba(0, 212, 255, 0.2)`, glow shadow appears (`0 0 24px -8px rgba(0, 212, 255, 0.18)`), `translateY(-2px)` float
- `transition: all 0.3s var(--ease-aurora)`

### 3.4 Tag

**OLD:**
- `border-radius: var(--radius-sm)` (~4px) — square-ish chip
- Color variants: filled bg per semantic color
- Standard padding

**NEW (Aurora):**
- `border-radius: 100px` — **full pill shape**
- `border: 1px solid rgba(0, 212, 255, 0.08)` — aurora-tinted border
- `transition: all 0.2s var(--ease-aurora)` — smooth interaction

### 3.5 Checkbox

**OLD:**
- 16px square with `var(--radius-xs)` (~2px)
- Checked: solid primary color bg
- Shadow: subtle border shadow
- No glow

**NEW (Aurora):**
- Same size/radius (checkboxes stay small)
- **Checked state:** adds cyan glow halo `--glow-cyan` — the checkbox literally glows when checked
- Disabled state preserved

### 3.6 Switch

**OLD:**
- 34×18px toggle pill
- Checked: solid primary bg with white thumb
- Standard transition

**NEW (Aurora):**
- Same dimensions (switches are standard)
- **Checked state:** cyan glow halo `--glow-cyan` — glowing toggle
- Glow provides visual emphasis beyond just color change

### 3.7 Radio Group

**OLD:**
- 16px circle with border
- Checked: inner dot appears, primary border
- No glow

**NEW (Aurora):**
- Checked: border color → `--aurora-accent` (cyan)
- Adds `--glow-cyan` halo — glowing selected radio
- Consistent with checkbox/switch glow language

### 3.8 Text Field / Input

**OLD:**
- `border-radius: var(--radius-md)` (~8px)
- Border: `var(--border-weak-base)`
- Focus: border changes to `var(--border-focus)`, standard focus ring
- Shadow: `var(--shadow-xs-border-base)` → `var(--shadow-xs-border-focus)`

**NEW (Aurora):**
- `border-radius: 10px`
- Focus: border → `rgba(0, 212, 255, 0.35)`, shadow → `--glow-cyan-focus` (35px spread cyan glow + 3px ring)
- Input literally **glows cyan** when focused
- `transition: border-color 0.25s, box-shadow 0.25s var(--ease-aurora)`
- Textarea and select get same treatment

### 3.9 Inline Input

**OLD:**
- Small inline input with `var(--radius-sm)` (~4px)
- Minimal styling

**NEW (Aurora):**
- `border-radius: 6px` — slightly larger
- Inherits focus glow from global input rule

### 3.10 Select

**OLD:**
- `var(--radius-md)` (~8px)
- Standard dropdown appearance

**NEW (Aurora):**
- `border-radius: 10px`
- Dropdown content gets glass treatment (via popover rules)

### 3.11 Progress Bar

**OLD:**
- `border-radius: var(--radius-sm)` (~4px) — barely rounded
- Solid primary fill
- Track: muted background

**NEW (Aurora):**
- `border-radius: 100px` — **full pill shape** (both track and fill)
- Fill: `linear-gradient(90deg, cyan, violet)` — **aurora gradient**
- Fill glow: `0 0 12px -2px rgba(0, 212, 255, 0.4)` — the bar glows
- Overflow hidden to clip gradient

### 3.12 Progress Circle

**OLD:**
- SVG circle with stroke animation
- Primary color stroke

**NEW (Aurora):**
- No major visual change (SVG strokes don't benefit from glass/glow)
- Color inherits from aurora accent tokens

### 3.13 Spinner

**OLD:**
- Animated loading indicator
- Color: `var(--icon-base)` or inherits

**NEW (Aurora):**
- `color: var(--aurora-accent)` — **always cyan** (branded spinner)

### 3.14 Keybind Badge

**OLD:**
- `border-radius: 2px` — nearly square
- `box-shadow: var(--shadow-xxs-border)` — micro shadow
- 20px height, 12px text
- Muted appearance

**NEW (Aurora):**
- `border-radius: 6px` — softer corners
- `border: 1px solid rgba(0, 212, 255, 0.08)` — aurora-tinted border
- Same size/text

### 3.15 Avatar

**OLD:**
- `border-radius: var(--radius-sm)` (~4px) — squircle
- Info-toned bg with monospace uppercase text
- Sizes: 20/24/32px

**NEW (Aurora):**
- No major change — avatars remain compact identity markers
- Inherits aurora color tokens naturally

### 3.16 Tooltip

**OLD:**
- `border-radius: var(--radius-md)` (~8px)
- Solid raised surface bg
- `box-shadow: var(--shadow-md)`
- Standard fade animation

**NEW (Aurora):**
- `border-radius: 10px`
- `backdrop-filter: blur(12px)` — **frosted glass tooltip**
- `border: 1px solid rgba(0, 212, 255, 0.08)` — aurora border
- Glass is visible through the tooltip

### 3.17 Toast

**OLD:**
- `border-radius: var(--radius-lg)` (~12px)
- Solid surface bg
- Shadow for elevation
- Slide-in animation

**NEW (Aurora):**
- `border-radius: 14px`
- `backdrop-filter: blur(16px)` — **frosted glass notification**
- `border: 1px solid rgba(0, 212, 255, 0.08)` — aurora border

---

## 4. Surface Components

### 4.1 Dialog / Modal

**OLD:**
- `border-radius: var(--radius-xl)` (~16px)
- Solid bg: `var(--surface-raised-stronger-non-alpha)` with `background-clip: padding-box`
- Shadow: `var(--shadow-lg-border-base)` + 1px ring via box-shadow
- Overlay: `hsl(... / 0.35)` bg + `backdrop-filter: blur(4px)`
- Open animation: `scale(0.96) translateY(4px)` → `scale(1)` in 250ms `cubic-bezier(0.16, 1, 0.3, 1)`
- Close animation: 120ms ease-in
- Header padding: `16px 20px`

**NEW (Aurora):**
- `border-radius: 18px` (--aurora-radius-xl) — larger, softer
- `background: rgba(7, 7, 16, 0.92)` — deep frosted glass (not opaque)
- `backdrop-filter: blur(24px)` — heavy blur (6x more than old overlay)
- Shadow: compound glow — `0 0 0 1px rgba(0, 212, 255, 0.1)` ring + `0 0 80px -15px rgba(0, 212, 255, 0.15)` aurora haze + `0 30px 80px -20px rgba(0, 0, 0, 0.6)` depth shadow
- `border: 1px solid rgba(0, 212, 255, 0.08)` — visible aurora border
- Overlay: deeper `rgba(5, 5, 10, 0.65)` with `blur(8px)` (double the old blur)
- Open animation: `scale(0.92) translateY(8px)` → `scale(1)` in 300ms `var(--ease-snappy)` — **more dramatic spring**
- Close animation: `scale(0.95) translateY(4px)` in 150ms ease-in
- Header padding: `20px 24px` — more breathing room
- Title: `17px` font, `600 weight`, `-0.02em` tracking — tighter, bolder
- Body padding: `0 8px`

### 4.2 Popover

**OLD:**
- `border-radius: var(--radius-lg)` (~12px)
- Solid bg with `background-clip: padding-box`
- `box-shadow: var(--shadow-lg)`
- No backdrop blur
- Scale animation: `0.95` → `1` in 150ms

**NEW (Aurora):**
- `border-radius: 14px`
- `background: rgba(7, 7, 16, 0.92)` — frosted glass
- `backdrop-filter: blur(20px)` — **glass effect added**
- Shadow: `0 0 0 1px rgba(0, 212, 255, 0.1)` ring + `0 20px 60px -10px rgba(0, 0, 0, 0.5)` depth
- `border: 1px solid rgba(0, 212, 255, 0.08)`

### 4.3 Dropdown Menu

**OLD:**
- Same as popover: solid bg, standard shadow
- `border-radius: var(--radius-lg)`

**NEW (Aurora):**
- Same glass treatment as popover — frosted glass with `blur(20px)`, aurora glow shadow, cyan-tinted border

### 4.4 Context Menu

**OLD:**
- Same solid surface pattern

**NEW (Aurora):**
- Same frosted glass treatment — all menus are now glass

### 4.5 Hover Card

**OLD:**
- `border-radius: var(--radius-lg)` (~12px)
- Solid raised bg
- Standard shadow

**NEW (Aurora):**
- `border-radius: 14px`
- `backdrop-filter: blur(16px)` — frosted glass
- `border: 1px solid rgba(0, 212, 255, 0.08)`
- Shadow: full popover shadow system

---

## 5. Navigation Components

### 5.1 Tabs

**OLD:**
- Multiple variants: normal, alt, pill, settings, review
- Active indicator: border-bottom with interactive color
- Radius: `var(--radius-sm)` to `var(--radius-md)` depending on variant
- Transition: 150ms cubic-bezier for bg/border
- Plain active underline

**NEW (Aurora):**
- Container: `border-radius: 10px`
- Alt variant active indicator: `border-bottom-color: var(--aurora-accent)` (cyan), `2px` width — **branded accent underline**
- Trigger: `border-radius: 6px`, `transition: all 0.2s var(--ease-aurora)`

### 5.2 List / List Item

**OLD:**
- Selected: `var(--surface-base-active)` bg
- Hover: `var(--surface-base-hover)` bg
- No accent border
- Standard transitions

**NEW (Aurora):**
- Selected: `rgba(0, 212, 255, 0.06)` tinted bg + `2px left border cyan` — **accent selection indicator**
- Hover: `rgba(0, 212, 255, 0.04)` — subtle aurora tint

### 5.3 Accordion

**OLD:**
- `border-radius: var(--radius-md)` (~8px)
- Standard trigger hover: bg change
- No special styling

**NEW (Aurora):**
- `border-radius: 14px`
- Trigger hover: `rgba(0, 212, 255, 0.04)` — aurora tint
- `transition: all 0.2s var(--ease-aurora)`

### 5.4 Collapsible

**OLD:**
- Trigger: no visible background, standard cursor
- No hover feedback
- Chevron rotation animation

**NEW (Aurora):**
- Trigger: `border-radius: 10px`, `padding: 6px 10px`, `margin: -6px -10px` — click target larger than visible area
- Hover: `rgba(0, 212, 255, 0.04)` bg — visible feedback
- `transition: all 0.2s var(--ease-aurora)`
- File tools (write/edit/patch): get `1px solid rgba(0, 212, 255, 0.08)` border + `14px radius` + overflow hidden → hover adds aurora glow

### 5.5 Message Nav

**OLD:**
- Small navigation arrows for scrolling between messages
- Standard icon button styling

**NEW (Aurora):**
- Inherits icon button aurora treatment (glow on hover)

---

## 6. Layout & Shell

### 6.1 Sidebar

**OLD:**
- `background: var(--background-strong)`
- `border-right: 1px solid var(--border-weaker-base)`
- Solid, opaque

**NEW (Aurora):**
- `background: rgba(7, 7, 16, 0.92)` — **frosted glass panel**
- `backdrop-filter: blur(20px)` — glass blur
- `border-right: 1px solid rgba(0, 212, 255, 0.08)` — aurora-tinted separator
- Content behind sidebar is subtly visible through the glass

### 6.2 Titlebar / Session Header

**OLD:**
- `background: var(--background-strong)` or transparent
- `border-bottom: 1px solid var(--border-weaker-base)`
- No blur, no glass

**NEW (Aurora):**
- `background: rgba(14, 14, 20, 0.85)` — semi-transparent glass
- `backdrop-filter: blur(20px)` — frosted glass header
- `border-bottom: 1px solid rgba(0, 212, 255, 0.08)` — aurora edge
- Session content scrolls behind the glass titlebar

### 6.3 Resize Handle

**OLD:**
- Thin divider line, `var(--border-weak-base)` color
- Cursor: col-resize / row-resize
- No hover feedback color

**NEW (Aurora):**
- Hover: `background: var(--aurora-accent)` at `opacity: 0.5` — **cyan accent line**
- Active: same cyan at `opacity: 0.8`
- Clear visual feedback during resize

### 6.4 Scrollbar

**OLD:**
- `scrollbar-width: none` — **completely hidden** (no visual scrollbar!)
- `::-webkit-scrollbar { display: none }`

**NEW (Aurora):**
- `scrollbar-width: thin` — **visible but minimal**
- Track: transparent
- Thumb: `rgba(0, 212, 255, 0.15)` — cyan-tinted, nearly invisible at rest
- Thumb hover: `rgba(0, 212, 255, 0.3)` — brightens on hover
- Width: 5px
- `border-radius: 100px` — pill shape
- Scrollbar is now **functional** — users can see where they are in the content

---

## 7. Chat & Messaging

### 7.1 Prompt Dock (Hero Component)

This is the most important component — the central input area.

**OLD:**
- `border-radius: var(--radius-xl)` (~16px)
- `background: var(--surface-raised-stronger-non-alpha)` — solid opaque
- `box-shadow: var(--shadow-lg)` — standard elevation
- No glass, no glow
- Focus: standard border color change

**NEW (Aurora):**
- `border-radius: 18px` (--aurora-radius-xl)
- `background: rgba(14, 14, 20, 0.85)` — **glass morphism**
- `backdrop-filter: blur(24px)` — heavy glass blur
- `border: 1px solid rgba(0, 212, 255, 0.08)` — aurora border
- Shadow: `0 -4px 20px -4px rgba(0, 0, 0, 0.1)` — subtle upward depth
- **Focus state (the magic moment):**
  - Border: `rgba(0, 212, 255, 0.35)` — bright cyan
  - Shadow: `0 0 0 4px rgba(0, 212, 255, 0.12)` ring + `0 0 50px -10px rgba(0, 212, 255, 0.3)` haze + `0 20px 60px -15px rgba(0, 0, 0, 0.5)` depth — **the dock glows cyan when typing**
- `transition: border-color 0.3s, box-shadow 0.35s var(--ease-aurora)` — smooth glow ramp

**Send Button (inside dock):**
- OLD: Standard primary button
- NEW: `border-radius: 14px`, `box-shadow: 0 0 20px rgba(0, 212, 255, 0.35)` — **always-glowing orb**
- Hover: glow intensifies to `0 0 40px rgba(0, 212, 255, 0.55)`, `translateY(-1px) scale(1.03)` float

**Tray Surface:**
- `border-radius: 18px` with aurora border

### 7.2 User Message

**OLD:**
- No identity label
- No special bubble styling
- Content rendered as plain markdown
- No border, no distinct visual treatment

**NEW (Aurora):**
- **Identity label:** `"You"` label above message, right-aligned, `11px` uppercase `700 weight`, `letter-spacing: 0.5px`, colored with agent-ask accent
- **Message bubble:**
  - `border-radius: 14px 2px 14px 14px` — **chat-bubble shape** (flat top-right for "speech" direction)
  - `padding: 16px 20px`
  - `background: rgba(surface, 70%)` with `backdrop-filter: blur(12px)` — **glass morphism bubble**
  - `border: 1px solid rgba(border, 50%)`
  - `box-shadow: 0 12px 20px -5px hsl(0 0 0 / 0.08)` — soft depth
- **Left border:** 3px solid `rgba(0, 212, 255, 0.5)` cyan — user identity color
- `padding-left: 16px` — indented from border

### 7.3 Assistant Message

**OLD:**
- No identity label
- Plain markdown rendering
- Same as user visually

**NEW (Aurora):**
- **Identity label:** `"⬡  OPENCODE AI"` — hexagon symbol + branded name
  - `11px`, `700 weight`, `letter-spacing: 1.5px`, uppercase
  - Color: `var(--icon-agent-plan-base)` — aurora accent
  - `margin-bottom: 14px`
- **Left border:** 3px solid `rgba(167, 139, 250, 0.45)` — **violet** (distinct from user's cyan)
- `padding-left: 16px`
- **Prose constraint:** `max-width: 72ch` — readable line length
- **No bubble** — assistant messages are open-flow (only user gets bubble treatment)

### 7.4 Thinking / Reasoning Block

**OLD:**
- Plain collapsible text
- Thinking text: `color: var(--text-weak)` / `var(--text-weaker)`
- No visual indicator beyond text
- No special container

**NEW (Aurora):**
- **Container:**
  - `padding: 10px 16px`
  - `border-radius: 12px`
  - `background: rgba(background-strong, 30%)` transparent tint
  - `border: 1px solid rgba(border, 50%)`
  - `cursor: pointer` (clickable to expand)
- **Pulsing dot indicator:**
  - `::before` pseudo-element: 8px circle
  - `background: #00D4FF` (cyan)
  - `box-shadow: 0 0 8px #00D4FF` — **glowing dot**
  - `animation: aurora-breathe 2s ease-in-out infinite` — pulsing glow
  - The dot breathes between `opacity: 0.7` (dim glow) and `1.0` (bright glow)
- **Reasoning part (expanded):**
  - `border: 1px solid rgba(0, 212, 255, 0.08)`
  - `border-radius: 14px`
  - `background: rgba(255, 255, 255, 0.02)`
  - Content: mono font, small size, weak color

### 7.5 Session Turn Container

**OLD:**
- `gap: 24px` between messages
- Each message: `padding: 16px 0`, separated by `1px solid var(--border-weaker-base)` bottom border
- Background: `var(--background-stronger)`
- Hidden scrollbar

**NEW (Aurora):**
- `padding: 20px 0` — more vertical breathing room
- Border dividers: `var(--aurora-border)` color (cyan-tinted)
- Background preserved from theme tokens
- **Scrollbar now visible** (see §6.4)

### 7.6 Message Part

**OLD:**
- Generic container with some padding
- No special border or radius

**NEW (Aurora):**
- `border-radius: 10px`
- Clean containment for tool results, file previews, etc.

### 7.7 Empty State

**OLD:**
- Plain centered text on flat background
- No atmosphere

**NEW (Aurora):**
- `background: radial-gradient(ellipse 60% 40% at 50% 60%, rgba(0, 212, 255, 0.08), rgba(167, 139, 250, 0.04) 50%, transparent)` — **ambient aurora gradient**
- Subtle cyan-to-violet radial glow centered below middle of screen
- Creates a sense of depth and atmosphere in the empty state

---

## 8. Code & Dev Tools

### 8.1 Code Blocks (Markdown `pre`)

**OLD:**
- `border-radius: var(--radius-lg)` (~12px)
- `background: var(--surface-inset-strong)` — solid dark bg
- `box-shadow: var(--shadow-xs-border-base)` — subtle border shadow
- No distinct border
- Copy button: hidden until hover

**NEW (Aurora):**
- `border-radius: 14px`
- `background: rgba(5, 5, 12, 0.7)` in dark / `rgba(232, 232, 242, 0.55)` in light — **slightly transparent** (glass hint)
- `border: 1px solid rgba(0, 212, 255, 0.1)` — subtle aurora border
- `box-shadow: none` — removed (border replaces shadow)
- `overflow: hidden` — code stays contained
- Copy button: **always visible** (see §8.7)

### 8.2 Inline Code

**OLD:**
- `border-radius: var(--radius-xs)` (~2px)
- Standard bg/color

**NEW (Aurora):**
- `border-radius: 6px` — softer
- `padding: 2px 7px`
- `font-size: 0.88em`
- Color: `var(--markdown-code)` from aurora tokens

### 8.3 Diff Changes

**OLD:**
- Minimal styling, standard inset bg
- Standard radius

**NEW (Aurora):**
- `border-radius: 6px` — slightly rounded
- Inherits aurora color tokens for additions/deletions

### 8.4 File Write/Edit/Patch Tools

**OLD:**
- Collapsible trigger with no border
- No hover card treatment
- Plain bg

**NEW (Aurora):**
- Wrapped in `1px solid rgba(0, 212, 255, 0.08)` border
- `border-radius: 14px`
- `overflow: hidden` — contained card
- **Hover: border brightens + aurora glow shadow appears** (`0 0 24px -8px rgba(0, 212, 255, 0.18)`)
- These tool results look like distinct, hoverable cards

### 8.5 Basic Tool

**OLD:**
- Plain container, minimal borders
- No hover state

**NEW (Aurora):**
- `border-radius: 10px`
- `border: 1px solid rgba(0, 212, 255, 0.08)`
- Hover: border → `rgba(0, 212, 255, 0.2)` — brightens

### 8.6 Bash Output

**OLD:**
- Standard inset bg with basic radius
- `max-height` scroll area

**NEW (Aurora):**
- `border-radius: 14px`
- `border: 1px solid rgba(0, 212, 255, 0.1)` — code-style border
- `background: rgba(5, 5, 12, 0.7)` — deep void bg (matches code blocks)
- Scroll area: `max-height: 200px`

### 8.7 Copy Button

**OLD:**
- Hidden by default (`opacity: 0`)
- Appears on hover over code block
- Standard icon button (square, secondary variant)

**NEW (Aurora):**
- **Always visible** (`opacity: 1`, `pointer-events: auto`)
- `border-radius: 6px`
- `padding: 2px 8px` — compact text-like button
- `background: transparent`, no border, no shadow — **minimal text button**
- Color: `var(--text-weak)` → hover: `var(--aurora-accent)` (cyan) — text turns cyan on hover
- Copied state: `var(--icon-success-base)` (green checkmark color)
- No longer hidden — user always knows copying is available

### 8.8 Permission Prompt

**OLD:**
- Standard tool wrapper with warning border
- Basic radius
- No glow

**NEW (Aurora):**
- `border-radius: 14px`
- `box-shadow: 0 0 0 1px rgba(255, 187, 51, 0.35)` ring + `0 0 24px -6px rgba(255, 187, 51, 0.25)` — **amber glow warning**
- The permission prompt literally glows amber — unmissable visual signal

---

## 9. Content & Typography

### 9.1 Markdown Renderer

**OLD:**
- Standard markdown styling from theme tokens
- No max-width constraint
- Headings, bold, italic inherit from tokens

**NEW (Aurora):**
- `max-width: 72ch` — **readable line length constraint** (prevents ultra-wide text)
- `overflow-wrap: anywhere`, `word-break: break-word` — prevents horizontal overflow
- All heading/strong/em/code colors from aurora tokens

### 9.2 Blockquotes

**OLD:**
- Left border with theme color
- Standard padding

**NEW (Aurora):**
- `border-left-width: 3px` — thicker accent
- `border-radius: 0 6px 6px 0` — **rounded right edge** (only blockquotes get this)
- `padding: 8px 16px`
- Color: `var(--markdown-block-quote)` from aurora tokens

### 9.3 Ordered Lists

**OLD:**
- Browser default numbered list
- Standard list-style-type: decimal
- Padding-left for indent

**NEW (Aurora):**
- **Custom counter system** — `counter-reset: list-counter`
- `list-style: none` — browser numbers removed
- `::before` pseudo: `counter(list-counter) "."`
- Number color: `var(--aurora-accent)` — **cyan accent counters**
- `font-weight: 600`, `font-variant-numeric: tabular-nums` — aligned, bold numbers
- `position: absolute; left: 0` with `padding-left: 2em` — clean hanging indent

### 9.4 Links

**OLD:**
- Colored with theme link color
- Standard underline/hover

**NEW (Aurora):**
- Color: `var(--markdown-link)` from aurora tokens
- Hover: `text-shadow: 0 0 12px currentColor` — **link glows on hover**
- `transition: text-shadow 0.2s, color 0.2s var(--ease-aurora)`

### 9.5 Headings

**OLD:**
- Standard weight/size from markdown defaults
- No tracking adjustment

**NEW (Aurora):**
- `letter-spacing: -0.02em` — **tighter tracking** (modern typographic style)
- Color from `var(--markdown-heading)` aurora tokens

---

## 10. Branding & Media

### 10.1 Logo

**OLD:**
- 16px mark with 4:5 aspect ratio
- No visual effects

**NEW (Aurora):**
- `filter: drop-shadow(0 0 6px var(--aurora-accent))` — **subtle cyan glow**
- Hover: glow doubles to `0 0 12px`
- `transition: filter 0.3s var(--ease-aurora)`
- Logo literally glows — "code illuminated from within"

### 10.2 Text Shimmer

**OLD:**
- Per-character opacity shimmer: `text-weaker → text-weak → text-base → text-strong`
- 1200ms cycle, 45ms stagger per character

**NEW (Aurora):**
- `background-image: linear-gradient(90deg, cyan, violet, rose, violet, cyan)` — **aurora rainbow gradient**
- `background-size: 300% 100%` — for smooth animation
- Shimmer cycles through aurora accent colors instead of just opacity

### 10.3 File Icon

**OLD:**
- Standard SVG icon rendering
- No hover effect

**NEW (Aurora):**
- Hover: `filter: drop-shadow(0 0 4px var(--aurora-accent))` — **icon glows cyan on hover**
- `transition: filter 0.2s var(--ease-aurora)`

### 10.4 Provider Icon

**OLD:**
- Standard SVG rendering (provider logos: Anthropic, OpenAI, etc.)
- No hover effect

**NEW (Aurora):**
- `transition: filter 0.2s var(--ease-aurora)` — ready for hover effects
- Subtle interaction preparation

### 10.5 App Icon

**OLD:**
- Standard icon rendering
- No special treatment

**NEW (Aurora):**
- Inherits general aurora interaction patterns

### 10.6 Image Preview

**OLD:**
- Full-screen overlay modal
- `border-radius: var(--radius-lg)` (~12px)
- Raised surface bg with heavy shadows

**NEW (Aurora):**
- `border-radius: 14px`
- `border: 1px solid rgba(0, 212, 255, 0.08)` — aurora border
- `overflow: hidden` — clean edge containment

### 10.7 Session Review

**OLD:**
- Standard panel with inset bg
- No distinct border treatment

**NEW (Aurora):**
- `border-radius: 14px`
- `border: 1px solid rgba(0, 212, 255, 0.08)` — aurora border
- Clean card-like containment

---

## 11. Animation System

### Keyframes

| Animation | Purpose | Behavior |
|-----------|---------|----------|
| `aurora-breathe` | Thinking indicator glow | Opacity 0.7↔1.0, shadow 8px↔18px, 2s ease-in-out infinite |
| `aurora-breathe-light` | Light mode variant | Same pattern, teal instead of cyan, softer glow |
| `aurora-pulse` | Generic element pulse | Shadow 8px↔20px, 2s cycle |
| `aurora-shimmer` | Background position | -200% → 200%, for gradient animations |
| `aurora-dialog-in` | Dialog open | scale(0.92) translateY(8px) → scale(1), 300ms snappy |
| `aurora-dialog-out` | Dialog close | scale(1) → scale(0.95) translateY(4px), 150ms ease-in |
| `thinkingPulse` | App-level thinking pulse | opacity 1↔0.5, shadow 8px↔2px, 1.5s |

### Reduced Motion

All animations respect `prefers-reduced-motion: reduce`:
- All `animation-duration` forced to `0.01ms`
- All `transition-duration` forced to `0.01ms`
- `animation-iteration-count: 1` — no looping

---

## 12. App Pages

### 12.1 Home Page

**Layout:** Centered content with logo at top, server status badge, list of recent projects (or empty state with "Open project" button).

**Aurora Changes:**
- Logo: glowing cyan drop-shadow
- Empty state: aurora radial gradient background
- Project list items: glow selection (cyan left border + tinted bg)
- Button: primary glow CTA

### 12.2 Session Page

**Layout:** Three-zone layout:
1. **Sidebar** (left) — session list, project info
2. **Main content** (center) — message thread with auto-scroll
3. **Prompt dock** (bottom) — fixed input area

**Aurora Changes:**
- Sidebar: frosted glass panel with blur
- Titlebar: glass header with blur
- Messages: user bubbles with glass + cyan border, assistant with violet border + identity label
- Thinking: pulsing glow dot
- Prompt dock: glass morphism with focus glow
- Code blocks: aurora-bordered, deep void bg
- Tools: card treatment with hover glow
- Permissions: amber glow warning
- Scrollbar: thin, cyan-tinted, visible
- Empty state: aurora gradient atmosphere

---

## 13. Global Effects

### Grain Texture Overlay

**OLD:** No texture
**NEW:** `body::before` pseudo-element:
- `position: fixed; inset: 0` — covers entire viewport
- `opacity: 0.02` — barely perceptible
- SVG noise pattern: `feTurbulence fractalNoise baseFrequency=0.9 numOctaves=4`
- `pointer-events: none; z-index: 9999` — non-interactive, top layer
- Creates organic, film-like texture over the entire app

### Selection Color

**OLD:** Browser default
**NEW:** `::selection { background: rgba(0, 212, 255, 0.22) }` — cyan-tinted text selection

### Focus Visible

**OLD:** Standard browser outline
**NEW:** `2px solid var(--aurora-accent)` outline, `2px` offset — cyan focus rings

### Cursor Mandate

**OLD:** Some elements missing pointer cursor
**NEW:** All buttons, links, triggers, summaries explicitly get `cursor: pointer`

---

## Summary: Design Language Shift

| Aspect | OLD (oc-1) | NEW (Aurora) |
|--------|-----------|--------------|
| **Philosophy** | Flat, utilitarian | Luminescent, atmospheric |
| **Backgrounds** | Solid opaque | Glass morphism (blur + transparency) |
| **Borders** | Theme tokens (gray) | Cyan-tinted rgba borders |
| **Shadows** | CSS shadow tokens | Contextual glow halos |
| **Radius** | 4-16px (token-based) | 6-24px (larger, softer) |
| **Hover** | Background color change | Glow + float + border brighten |
| **Focus** | Standard ring | Cyan glow with 3px ring |
| **Active** | Scale down | Scale down + glow reset |
| **Colors** | Neutral grays | Cyan/violet/amber/rose semantic |
| **User identity** | None | Cyan border + "You" label |
| **Assistant identity** | None | Violet border + "⬡ OPENCODE AI" |
| **Thinking** | Plain text | Pulsing glow dot + card |
| **Code blocks** | Solid bg + shadow | Glass bg + aurora border |
| **Scrollbar** | Hidden | Visible, thin, cyan-tinted |
| **Animations** | 150ms ease | Spring/snappy easing |
| **Texture** | None | Film grain overlay |
| **Selection** | Default | Cyan-tinted |
| **Progress** | Solid fill | Aurora gradient + glow |
| **Tags** | Square chips | Full pill shape |
| **Menus/Dialogs** | Solid raised | Frosted glass + glow shadow |
| **Logo** | Static | Glowing drop-shadow |
| **Links** | Standard | Glow on hover |
