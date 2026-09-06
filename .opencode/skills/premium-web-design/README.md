# Premium Web Design Skill

**Transform any website into a premium, Apple-quality web experience.**

An [Agent Skill](https://agentskills.io) that turns your AI coding assistant into a premium web design expert. Based on 80+ peer-reviewed scientific studies, analysis of 10 premium brands (Apple, Stripe, Tesla, Porsche, Rolex, Linear, Airbnb, Bang & Olufsen, Aesop, Vercel), and current industry best practices (2024-2026).

## Installation

```bash
npx skills add Lucxar/premium-web-design-skill
```

Works with **Claude Code**, **Cursor**, **VS Code Copilot**, **Gemini CLI**, **OpenAI Codex**, and [30+ other AI tools](https://agentskills.io) that support the Agent Skills open standard.

### Manual Installation

Copy the skill folder to your skills directory:

```bash
# Personal (all projects)
cp -r . ~/.claude/skills/premium-web-design/

# Project-specific
cp -r . .claude/skills/premium-web-design/
```

## What It Does

When activated, your AI assistant becomes a premium web design expert that:

- **Designs from first principles** -- every decision passes the "Would this feel at home on Apple.com?" test
- **Applies scientific research** -- uses findings from 80+ peer-reviewed studies (50ms first impression rule, aesthetic-usability effect, cognitive load theory, color psychology)
- **Provides specific values** -- no vague advice like "use good colors", instead: exact hex codes, pixel values, CSS custom properties, easing curves
- **Includes ready-to-use code** -- copy-paste CSS design tokens, animation patterns, scroll reveals, hover effects
- **Catches anti-patterns** -- flags 15 common mistakes that destroy premium feel (generic stock photos, linear easing, pop-ups in first 5 seconds, etc.)
- **Avoids AI-generated aesthetics** -- identifies and avoids 10 common AI tells (purple gradients, uniform border-radius, same hero layout, identical card grids)
- **Varies design per project** -- 10 genre-based font pairings, 5 design style palettes, 6 hero variants prevent cookie-cutter output
- **Guides content flow** -- section transitions, rhythm patterns, content pacing, and the "breathing rule" create cohesive pages
- **Writes premium copy** -- headline formulas, tone of voice rules, and action-specific CTA microcopy

## When It Activates

The skill activates automatically when you mention:

- "premium", "luxury", "high-end", "Apple-like", or "professional" website design
- Building or redesigning landing pages
- Improving visual hierarchy or web aesthetics
- Adding animations or micro-interactions
- Creating hero sections

Or invoke it directly: `/premium-web-design`

## What's Inside

| File | Content |
|------|---------|
| `SKILL.md` | Core expertise: 10 Laws, 6 hero variants, section flow system, premium copy patterns, AI-tell avoidance, landing page blueprint, CSS patterns, anti-patterns, verification checklist |
| `design-tokens.md` | Copy-paste CSS custom properties, 10 genre-based font pairings, 5 design style palettes (Warm Premium, Cool Tech, Bold Dark, Minimal Editorial, Colorful Modern) |
| `brand-patterns.md` | Design pattern analysis of 11 premium brands with hero patterns, style palette tags, specific fonts, hex codes, and techniques |
| `scientific-evidence.md` | 80+ peer-reviewed studies including copy/content research and first-impression layout studies |
| `animation-cookbook.md` | Ready-to-use animation code (CSS, GSAP, Framer Motion) with timing guides and easing references |

## The 10 Laws of Premium Web Design

1. **The 50ms Rule** -- Above-the-fold must communicate quality instantly
2. **One Thing Per Section** -- Each viewport section = one idea, one action
3. **Typography Is Identity** -- Max 2-3 fonts, clear hierarchy, fluid scaling
4. **Color Restraint** -- 60-30-10 rule, max 2-3 core colors
5. **White Space Is Luxury** -- 40% content, 60% space for premium feel
6. **Animate With Purpose** -- 150-500ms, ease-out curves, transform/opacity only
7. **Images Make or Break Premium** -- No stock photos, AVIF/WebP, responsive
8. **Performance IS Premium** -- LCP <= 2.5s, CLS <= 0.1, 60fps animations
9. **Guide, Don't Overwhelm** -- Single CTA per section, progressive disclosure
10. **Consistency Is Craft** -- 8px grid, design tokens, unified shadow/radius/easing systems

## Key Statistics From Research

| Finding | Value | Source |
|---------|-------|--------|
| First impression formation | 50ms | Lindgaard et al., 2006 |
| First impressions design-related | 94% | ODI Consulting |
| Credibility judged by design | 46.1% | Stanford Web Credibility Project |
| Conversion: 6 vs 24 options | 30% vs 3% | Iyengar & Lepper, 2000 |
| Visual attractiveness vs interactivity for engagement | 4x more important | Skadberg & Kimmel, 2004 |
| Single CTA click increase | +371% | Unbounce |
| Strategy redesign ROI (Year 1) | 287% | ThrillX Design |

## Premium Brands Analyzed

Apple, Tesla, Stripe, Linear, Porsche, Rolex, Bang & Olufsen, Aesop, Vercel, Airbnb -- with specific hex codes, font names, hero patterns, animation techniques, and what makes each feel premium.

## Example Usage

```
User: "Build me a landing page for my SaaS product"
→ Skill activates, AI applies premium design principles automatically

User: "This website looks generic, make it feel more premium"
→ Skill identifies anti-patterns and applies the 10 Laws

User: /premium-web-design redesign the hero section
→ Direct invocation with specific task
```

## Contributing

Found a study, brand pattern, or technique that should be included? PRs welcome.

## License

MIT
