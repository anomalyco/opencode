---
name: frontend
description: "MUST USE for ANY frontend, web UI, UX, or visual work — building, styling, or redesigning pages/components, React project setup, performance audits, design QA. Routes three rulesets: design (anti-slop taste router over 12 taste skills + 69 brand DESIGN.md refs — Apple, Stripe, Linear, Notion, Vercel, Claude, Nike — plus React dev tooling gate: react-grab, react-scan, react-doctor), perfection (Lighthouse 100 in every category via real Playwright Chromium audits, NEVER the lighthouse CLI, never by weakening UX), ui-ux-db (searchable 50+ styles, 97 palettes, 57 font pairings, 99 UX guidelines). Triggers: frontend, UI, UX, design, redesign, styling, layout, animation, motion, taste, premium, luxury, minimal, brutalist, Awwwards, anti-slop, polish, DESIGN.md, mockup, react setup, react-scan, react-doctor, lighthouse, performance, Core Web Vitals, LCP, CLS, INP, SEO, accessibility, a11y, WCAG, audit my site, make this faster, color palette, font pairing, looks generic, make it pretty, like X brand."
---

# Frontend

This file is a router, not a rulebook. The rules live in three rulesets under `references/`; your first job is to load the smallest set of files that covers the request, state which you loaded in one sentence, then execute under their guidance. Loading nothing and freestyling produces the generic AI-slop output this skill exists to prevent; loading everything wastes context and creates contradictory instructions.

## Phase 0 — Route (before any UI work)

| Request involves… | Read |
|---|---|
| ANY UI implementation, styling, redesign, mockup, or visual decision | `references/design/README.md` FIRST. It enforces two mandatory gates — the Design System Gate (a `DESIGN.md` must exist before any component is written) and the React Dev Tooling Gate (react-grab / react-scan / react-doctor installed by default) — then routes to the taste and brand references below. |
| Writing or modifying frontend code, OR auditing performance / SEO / accessibility / quality | ALSO `references/perfection/README.md`. Lighthouse 100 in every category, measured on real Playwright Chromium (never the `lighthouse` CLI), achieved through architecture — never by dropping animations or hiding content. |
| Looking up a concrete style, color palette, font pairing, chart type, landing-page structure, or UX guideline — or generating a project design system from keywords | `references/ui-ux-db/README.md`. A searchable CSV database with a CLI; a lookup tool, not a posture. Load on demand; `design` stays the source of truth for taste and the `DESIGN.md` contract. |

**For implementation work, design + perfection load together.** A page that hits Lighthouse 100 but looks like AI slop has failed; a page that looks beautiful but ships a 2 MB bundle has failed. Both win or neither does.

## Ruleset 1 — design (`references/design/`)

The reference library has one architecture file, 12 taste skills (Layer A — *how to execute*), and 69 brand design systems (Layer B — *what it should look like*). Most non-trivial tasks load **one Layer A + one Layer B**. `README.md` carries the full routing flow, stacking rules, anti-patterns, and the mandatory browser-based Design QA phase; `_INDEX.md` catalogs all 81 files with mood-to-brand mappings — read it whenever routing is not obvious from the tables below.

### Layer 0 — architecture

| File | Read when |
|---|---|
| `design-system-architecture.md` | The project has no `DESIGN.md` (defines the 7-section structure you must create first), or you are extracting a design system from existing UI code. |

### Layer A — taste skills (pick AT MOST ONE style skill; they encode opposing philosophies)

| File | Read when the user says… |
|---|---|
| `taste-skill.md` | Nothing style-specific — "make a good UI". The default all-rounder. |
| `gpt-tasteskill.md` | "Awwwards-tier", "wow factor", "cinematic", "scroll-triggered", or `taste-skill` results felt too safe. |
| `minimalist-skill.md` | "minimal", "clean", "Notion-like", "Linear-like", "editorial". |
| `brutalist-skill.md` | "brutalist", "raw", "Swiss", "experimental", "anti-design". |
| `soft-skill.md` | "premium", "luxury", "calm", "expensive", "spa", "boutique", "elegant". |
| `redesign-skill.md` | Improving EXISTING UI — "this looks bad", "fix the design". Audit-first workflow; never use on greenfield. |
| `image-to-code-skill.md` | "Generate the design first, then code it." Pair with one imagegen file below. |
| `output-skill.md` | Stacks on any style skill when output is incomplete — placeholders, `// TODO`, half-done components. |
| `stitch-skill.md` | Stacks on any style skill for Google Stitch compatibility or a `DESIGN.md` doc export. |
| `imagegen-frontend-web.md` / `imagegen-frontend-mobile.md` / `imagegen-brandkit.md` | Image-only output (mockup, app-screen concepts, brand board). These NEVER write code — switch to `image-to-code-skill.md` if code is wanted. |

### Layer B — brand design systems (orthogonal to Layer A; stack freely)

When the user names a brand or site — "Linear-style", "like Stripe's landing" — load `references/design/<brand>.md` as the token source of truth (palette, type scale, components, do/don'ts). Coverage includes `apple` `stripe` `linear.app` `notion` `vercel` `claude` `figma` `airbnb` `nike` `tesla` `spotify` `raycast` `revolut` and ~56 more; the full list with mood shortcuts is in `_INDEX.md`. Extract the tokens and apply them to the project's own content — never copy logos or trademarked imagery. If the named brand is missing, fall back to a Layer A mood match or the `open-design` skill.

### React dev tooling

| File | Read when |
|---|---|
| `react-dev-tooling-skill.md` | A React project lacks react-grab / react-scan / react-doctor, or you need per-framework install snippets and the dev-only gating pattern (`NODE_ENV === 'development'`). |

## Ruleset 2 — perfection (`references/perfection/`)

| File | Read when |
|---|---|
| `README.md` | Any frontend code is written or audited. Carries the seven tenets: real-browser audits only, 100-in-every-category floor, fix-at-the-architecture, never weaken UX for points, design-system compliance checks, and the response format for audit reports. |
| `react-perf-tooling.md` | Before ANY React audit. The Playwright + `playwright-lighthouse` + `react-scan/lite` injection recipe, per-route render budgets, and the React-specific root-cause checklist. Lighthouse 100 with 30+ unnecessary renders is NOT done. |

Audit CLI (build for production first; never measure a dev server):

```bash
uv run $SKILL_DIR/scripts/perfection/lighthouse-audit.py https://localhost:3000
```

Run mobile AND desktop presets, 3–5 runs, take the median, diagnose from the JSON report.

## Ruleset 3 — ui-ux-db (`references/ui-ux-db/`)

`README.md` documents the search CLI and the master-plus-overrides persistence pattern. The CLI (run from the ruleset directory so it finds `data/`):

```bash
python3 $SKILL_DIR/references/ui-ux-db/scripts/search.py "<query>" --design-system -p "Project"   # full design-system generation
python3 $SKILL_DIR/references/ui-ux-db/scripts/search.py "<query>" --domain <domain>             # targeted lookup
python3 $SKILL_DIR/references/ui-ux-db/scripts/search.py "<query>" --stack <stack>               # stack best practices
```

Domains: `product` `style` `typography` `color` `landing` `chart` `ux` `react` `web` `prompt`. Stacks: `html-tailwind` (default) `react` `nextjs` `vue` `svelte` `astro` `swiftui` `react-native` `flutter` `shadcn` `jetpack-compose`.

## Quick routes — most common requests

| Request | Load |
|---|---|
| "Build a landing page" (no direction given) | `design/README.md` + `design/taste-skill.md` + `perfection/README.md` |
| "Linear-style landing page" | `design/README.md` + `design/linear.app.md` + `design/taste-skill.md` + `perfection/README.md` |
| "Premium SaaS hero like Stripe" | `design/README.md` + `design/stripe.md` + `design/soft-skill.md` + `perfection/README.md` |
| "Improve this existing dashboard" | `design/README.md` + `design/redesign-skill.md` + `perfection/README.md` |
| "Audit my site" / "make this page faster" | `perfection/README.md` (+ `perfection/react-perf-tooling.md` if React) |
| "Mockup image of a fintech app" — no code | `design/imagegen-frontend-mobile.md` (+ a Layer B brand if named) |
| "What palette/fonts fit a wellness brand?" | `ui-ux-db/README.md` → search CLI |
| "Set up this React project" | `design/README.md` + `design/react-dev-tooling-skill.md` |

## Shared axioms (all three rulesets agree — apply always)

- **No design system = no UI work.** `DESIGN.md` exists before components do; every color, font size, and spacing value traces back to a token in it.
- **Never weaken UX to buy points.** No dropping animations, hiding content, or simplifying interactions for a score or a deadline.
- **No emojis as icons.** SVG icon sets only (Lucide, Heroicons, Radix, Phosphor).
- **GPU-composited animation only** — `transform`, `opacity`, `filter`; never animate layout properties.
- **Verify in a real browser before declaring done.** Screenshots at 375 / 768 / 1280px; hover, focus, loading, empty, and error states all exercised.

## When to load something else instead

| Situation | Load |
|---|---|
| Brand/style not among the 69 in `references/design/`, or the user says "Open Design" | `open-design` skill — the local nexu-io/open-design library (137+ design skills, 150+ design systems) |
| Driving a browser for the Design QA phase | `agent-browser` skill |
| Pure TypeScript/logic work with zero visual surface | `programming` skill alone — this skill adds nothing there |

## Activation

Use for any frontend, web UI, UX, visual, design, styling, layout, animation, performance, accessibility, or SEO work — building, redesigning, auditing, or generating mockups. Not for backend, CLI, or pure-logic tasks with no visual surface.
