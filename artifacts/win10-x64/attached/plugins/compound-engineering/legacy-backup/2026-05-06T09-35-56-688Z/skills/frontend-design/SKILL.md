---
name: frontend-design
description: 'Build web interfaces with genuine design quality, not AI slop. Use for any frontend work - landing pages, web apps, dashboards, admin panels, components, interactive experiences. Activates for both greenfield builds and modifications to existing applications. Detects existing design systems and respects them. Covers composition, typography, color, motion, and copy. Verifies results via screenshots before declaring done.'
---

# Frontend Design

Guide creation of distinctive, production-grade frontend interfaces that avoid generic AI aesthetics. This skill covers the full lifecycle: detect what exists, plan the design, build with intention, and verify visually.

## Authority Hierarchy

Every rule in this skill is a default, not a mandate.

1. **Existing design system / codebase patterns** -- highest priority, always respected
2. **User's explicit instructions** -- override skill defaults
3. **Skill defaults** -- apply in greenfield work or when the user asks for design guidance

When working in an existing codebase with established patterns, follow those patterns. When the user specifies a direction that contradicts a default, follow the user.

## Workflow

```
Detect context -> Plan the design -> Build -> Verify visually
```

---

## Layer 0: Context Detection

Before any design work, examine the codebase for existing design signals. This determines how much of the skill's opinionated guidance applies.

### What to Look For

- **Design tokens / CSS variables**: `--color-*`, `--spacing-*`, `--font-*` custom properties, theme files
- **Component libraries**: shadcn/ui, Material UI, Chakra, Ant Design, Radix, or project-specific component directories
- **CSS frameworks**: `tailwind.config.*`, `styled-components` theme, Bootstrap imports, CSS modules with consistent naming
- **Typography**: Font imports in HTML/CSS, `@font-face` declarations, Google Fonts links
- **Color palette**: Defined color scales, brand color files, design token exports
- **Animation libraries**: Framer Motion, GSAP, anime.js, Motion One, Vue Transition imports
- **Spacing / layout patterns**: Consistent spacing scale usage, grid systems, layout components

Use the platform's native file-search and content-search tools (e.g., Glob/Grep in Claude Code) to scan for these signals. Do not use shell commands for routine file exploration.

### Mode Classification

Based on detected signals, choose a mode:

- **Existing system** (4+ signals across multiple categories): Defer to it. The skill's aesthetic opinions (typography, color, motion) yield to the established system. Structural guidance (composition, copy, accessibility, verification) still applies.
- **Partial system** (1-3 signals): Follow what exists; apply skill defaults only for areas where no convention was detected. For example, if Tailwind is configured but no component library exists, follow the Tailwind tokens and apply skill guidance for component structure.
- **Greenfield** (no signals detected): Full skill guidance applies.
- **Ambiguous** (signals are contradictory or unclear): Ask the user before proceeding.

### Asking the User

When context is ambiguous, use the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). If no question tool is available, assume "partial" mode and proceed conservatively.

Example question: "I found [detected signals]. Should I follow your existing design patterns or create something distinctive?"

---

## Layer 1: Pre-Build Planning

Before writing code, write three short statements. These create coherence and give the user a checkpoint to redirect before code is written.

1. **Visual thesis** -- one sentence describing the mood, material, and energy
   - Greenfield examples: "Clean editorial feel, lots of whitespace, serif headlines, muted earth tones" or "Dense data-forward dashboard, monospace accents, dark surface hierarchy"
   - Existing codebase: Describe the *existing* aesthetic and how the new work will extend it

2. **Content plan** -- what goes on the page and in what order
   - Landing page: hero, support, detail, CTA
   - App: primary workspace, nav, secondary context
   - Component: what states it has, what it communicates

3. **Interaction plan** -- 2-3 specific motion ideas that change the feel
   - Not "add animations" but "staggered fade-in on hero load, parallax on scroll between sections, scale-up on card hover"
   - In an existing codebase, describe only the interactions being added, using the existing motion library

---

## Layer 2: Design Guidance Core

These principles apply across all context types. Each yields to existing design systems and user instructions per the authority hierarchy.

### Typography

- Choose distinctive, characterful fonts. Avoid the usual suspects (Inter, Roboto, Arial, system defaults) unless the existing codebase uses them.
- Two typefaces maximum without a clear reason for more. Pair a display/headline font with a body font.
- *Yields to existing font choices when detected in Layer 0.*

### Color & Theme

- Commit to a cohesive palette using CSS variables. A dominant color with sharp accents outperforms timid, evenly-distributed palettes.
- No purple-on-white bias, no dark-mode bias. Vary between light and dark based on context.
- One accent color by default unless the product already has a multi-color system.
- *Yields to existing color tokens when detected.*

### Composition

- Start with composition, not components. Treat the first viewport as a poster, not a document.
- Use whitespace, alignment, scale, cropping, and contrast before adding chrome (borders, shadows, cards).
- Default to cardless layouts. Cards are allowed when they serve as the container for a user interaction (clickable item, draggable unit, selectable option). If removing the card styling would not hurt comprehension, it should not be a card.
- *All composition rules are defaults. The user can override them.*

### Motion

- Ship 2-3 intentional motions for visually-led work: one entrance sequence, one scroll-linked or depth effect, one hover/reveal transition.
- Use the project's existing animation library if one is present.
- When no existing library is found, use framework-conditional defaults:
  - **CSS animations** as the universal baseline
  - **Framer Motion** for React projects
  - **Vue Transition / Motion One** for Vue projects
  - **Svelte transitions** for Svelte projects
- Motion should be noticeable in a quick recording, smooth on mobile, and consistent across the page. Remove if purely ornamental.

### Accessibility

- Semantic HTML by default: `nav`, `main`, `section`, `article`, `button` -- not divs for everything.
- Color contrast meeting WCAG AA minimum.
- Focus states on all interactive elements.
- Accessibility and aesthetics are not in tension when done well.

### Imagery

- When images are needed, prefer real or realistic photography over abstract gradients or fake 3D objects.
- Choose or generate images with a stable tonal area for text overlay.
- If image generation tools are available in the environment, use them to create contextually appropriate visuals rather than placeholder stock.

---

## Context Modules

Select the module that fits what is being built. When working inside an existing application, default to Module C regardless of what the feature is.

### Module A: Landing Pages & Marketing (Greenfield)

**Default section sequence:**
1. Hero -- brand/product, promise, CTA, one dominant visual
2. Support -- one concrete feature, offer, or proof point
3. Detail -- atmosphere, workflow, product depth, or story
4. Final CTA -- convert, start, visit, or contact

**Hero rules (defaults):**
- One composition, not a dashboard. Full-bleed image or dominant visual plane.
- Brand first, headline second, body third, CTA fourth.
- Keep the text column narrow and anchored to a calm area of the image.
- No more than 6 sections total without a clear reason.
- One H1 headline. One primary CTA above the fold.

**Copy:**
- Let the headline carry the meaning. Supporting copy is usually one short sentence.
- Write in product language, not design commentary. No prompt language or AI commentary in the UI.
- Each section gets one job: explain, prove, deepen, or convert.
- Every sentence should earn its place. Default to less copy, not more.

### Module B: Apps & Dashboards (Greenfield)

**Default patterns:**
- Calm surface hierarchy, strong typography and spacing, few colors, dense but readable information, minimal chrome.
- Organize around: primary workspace, navigation, secondary context/inspector, one clear accent for action or state.
- Cards only when the card is the interaction (clickable item, draggable unit, selectable option). If a panel can become plain layout without losing meaning, remove the card treatment.

**Copy (utility, not marketing):**
- Prioritize orientation, status, and action over promise, mood, or brand voice.
- Section headings should say what the area is or what the user can do there. Good: "Plan status", "Search metrics". Bad: "Unlock Your Potential".
- If a sentence could appear in a homepage hero, rewrite it until it sounds like product UI.
- Litmus: if an operator scans only headings, labels, and numbers, can they understand the page immediately?

### Module C: Components & Features (Default in Existing Apps)

For adding to an existing application:

- Match the existing visual language. This module is about making something that belongs, not something that stands out.
- Inherit spacing scale, border radius, color tokens, and typography from surrounding code.
- Focus on interaction quality: clear states (default, hover, active, disabled, loading, error), smooth transitions between states, obvious affordances.
- One new component should not introduce a new design system. If the existing app uses 4px border radius, do not add a component with 8px.

---

## Hard Rules & Anti-Patterns

### Default Against (Overridable)

These are the skill being opinionated. The user can override any of them.

- Generic SaaS card grid as the first impression
- Purple-on-white color schemes, dark-mode bias
- Overused fonts (Inter, Roboto, Arial, Space Grotesk, system defaults) in greenfield work
- Hero sections cluttered with stats, schedules, pill clusters, logo clouds
- Sections that repeat the same mood statement in different words
- Carousel with no narrative purpose
- Multiple competing accent colors
- Decorative gradients or abstract backgrounds standing in for real visual content
- Copy that sounds like design commentary ("Experience the seamless integration")
- Split-screen heroes where text sits on the busy side of an image

### Always Avoid (Quality Floor)

These are genuine quality failures no user would want.

- Prompt language or AI commentary leaking into the UI
- Broken contrast -- text unreadable over images or backgrounds
- Interactive elements without visible focus states
- Semantic div soup when proper HTML elements exist

---

## Litmus Checks

Quick self-review before moving to visual verification. Not all checks apply in every context -- apply judgment about which are relevant.

- Is the brand or product unmistakable in the first screen?
- Is there one strong visual anchor?
- Can the page be understood by scanning headlines only?
- Does each section have one job?
- Are cards actually necessary where they are used?
- Does motion improve hierarchy or atmosphere, or is it just there?
- Would the design feel premium if all decorative shadows were removed?
- Does the copy sound like the product, not like a prompt?
- Does the new work match the existing design system? (Module C)

---

## Visual Verification

After implementing, verify visually. This is a sanity check, not a pixel-perfect review. One pass. If there is a glaring issue, fix it. If it looks solid, move on.

### Tool Preference Cascade

Use the first available option:

1. **Existing project browser tooling** -- if Playwright, Puppeteer, Cypress, or similar is already in the project's dependencies, use it. Do not introduce new dependencies just for verification.
2. **Browser MCP tools** -- if browser automation tools (e.g., claude-in-chrome) are available in the agent's environment, use them.
3. **agent-browser CLI** -- if nothing else is available and `agent-browser` is installed, use it. If not installed, inform the user: "`agent-browser` is not installed. Run `/ce-setup` to install required dependencies." Then skip to the next option.
4. **Mental review** -- if no browser access is possible (headless CI, no permissions to install), apply the litmus checks as a self-review and note that visual verification was skipped.

### What to Assess

- Does the output match the visual thesis from the pre-build plan?
- Are there obvious visual problems (broken layout, unreadable text, missing images)?
- Does it look like the context module intended (landing page feels like a landing page, dashboard feels like a dashboard, component fits its surroundings)?

### Scope Control

One iteration. Take a screenshot, assess against the litmus checks, fix any glaring issues, and move on. Include the screenshot in the deliverable (PR description, conversation output, etc.).

For iterative refinement beyond a single pass (multiple rounds of screenshot-assess-fix), see the `design-iterator` agent.

---

## Creative Energy

This skill provides structure, but the goal is distinctive work that avoids AI slop -- not formulaic output.

For greenfield work, commit to a bold aesthetic direction. Consider the tone: brutally minimal, maximalist, retro-futuristic, organic/natural, luxury/refined, playful, editorial, brutalist, art deco, soft/pastel, industrial -- or invent something that fits the context. There are endless flavors. Use these for inspiration but design one that is true to the project.

Ask: what makes this unforgettable? What is the one thing someone will remember?

Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well, not from intensity.
