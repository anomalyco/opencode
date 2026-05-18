<!-- Context: ui/navigation | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Web UI Context

**Purpose**: Web-based UI patterns, animations, styling standards, and React component design

**Last Updated**: 2026-01-07

---

## Quick Navigation

### Core Files

| File | Description | Priority |
|------|-------------|----------|
| [animation-basics.md](animation-basics.md) | Animation fundamentals, timing, easing | high |
| [animation-components.md](animation-components.md) | Button, card, modal, dropdown animations | high |
| [animation-chat.md](animation-chat.md) | Chat UI and message animations | medium |
| [animation-loading.md](animation-loading.md) | Skeleton, spinner, progress animations | medium |
| [animation-forms.md](animation-forms.md) | Form input and validation animations | medium |
| [animation-advanced.md](animation-advanced.md) | Recipes, best practices, accessibility | medium |
| [ui-styling-standards.md](ui-styling-standards.md) | CSS frameworks, Tailwind patterns, styling best practices | high |
| [react-patterns.md](react-patterns.md) | Modern React patterns, hooks, component design | high |
| [design-systems.md](design-systems.md) | Design system principles and component libraries | medium |
| [images-guide.md](images-guide.md) | Placeholder and responsive images | medium |
| [icons-guide.md](icons-guide.md) | Icon systems (Lucide, Heroicons, FA) | medium |
| [fonts-guide.md](fonts-guide.md) | Font loading and optimization | medium |
| [cdn-resources.md](cdn-resources.md) | CDN libraries and resources | medium |

### Subcategories

| Subcategory | Description | Path |
|-------------|-------------|------|
| **design/** | Advanced design patterns (scrollytelling, effects) | [design/navigation.md](design/navigation.md) |

---

## Loading Strategy

### For general web UI work:
1. Load `ui-styling-standards.md` (CSS frameworks, Tailwind)
2. Load `react-patterns.md` (component patterns)
3. Reference `animation-patterns.md` (if animations needed)

### For animation work:
1. Load `animation-basics.md` (fundamentals, timing, easing)
2. Load `animation-components.md` (UI component animations)
3. Reference `animation-chat.md` for chat UI patterns
4. Reference `animation-advanced.md` for recipes and accessibility

### For scroll animations:
1. Navigate to `design/` subcategory
2. Load scroll-linked animation guides

---

## Scope

This subcategory covers:
- ✅ CSS animations and transitions
- ✅ Tailwind CSS and utility-first styling
- ✅ React component patterns and hooks
- ✅ Design systems and component libraries
- ✅ Icon libraries and web fonts
- ✅ Scroll-linked animations (scrollytelling)
- ✅ Canvas-based rendering
- ✅ Framer Motion patterns

---

## File Summaries

### animation-basics.md, animation-components.md, animation-chat.md, animation-loading.md, animation-forms.md, animation-advanced.md
CSS animations, micro-interactions, and UI transitions split into focused modules.

**Key topics**: Animation micro-syntax, 60fps performance, reduced motion, chat UI animations, component patterns

### ui-styling-standards.md
CSS framework usage, Tailwind CSS patterns, responsive design, and styling best practices.

**Key topics**: Utility-first CSS, component styling, responsive breakpoints, dark mode

### react-patterns.md
Modern React patterns including functional components, hooks, state management, and performance optimization.

**Key topics**: Custom hooks, context API, code splitting, memoization

### design-systems.md
Design system principles, component libraries, and maintaining consistency across applications.

**Key topics**: Design tokens, component APIs, documentation, versioning

### images-guide.md, icons-guide.md, fonts-guide.md, cdn-resources.md
Managing design assets in web applications - split into focused guides.

**Key topics**: Placeholder images, icon libraries (Lucide, Heroicons), web fonts, CDN resources

---

## Related Categories

- `ui/terminal/` - Terminal UI patterns
- `development/` - General development patterns
- `product/` - Product design and UX strategy

---

## Used By

**Agents**: frontend-specialist, design-specialist, ui-developer, react-developer, animation-expert

---

## Statistics
- Core files: 8
- Subcategories: 1 (design/)
- **Total context files**: 8 + design subcategory
