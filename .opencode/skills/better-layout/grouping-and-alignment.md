# Grouping and alignment

How spacing, shapes, shared edges and ordering communicate what belongs together and what matters most.

## Group with space, not lines

Three tools create grouping, in order of preference:

1. **Negative space**, the default. Related items sit close, unrelated ones far apart.
2. **Background shapes**, a card or filled container, where a group must read as one unit such as a selectable row or a draggable card.
3. **Separator lines**, a last resort for dense data where space costs too much, such as tables and long settings lists.

The structural rule is that the gap between groups is at least 2× the gap within one. At `8px` inside a group, groups need `16px`+ between them, or the eye can't tell where one ends.

```css
/* Good: spacing alone communicates the grouping */
.field-group { display: flex; flex-direction: column; gap: 8px; }
.form { display: flex; flex-direction: column; gap: 24px; }

/* Bad: uniform spacing plus lines to compensate */
.form > * { margin-bottom: 12px; border-bottom: 1px solid var(--separator); }
```

```html
<!-- Good: Tailwind -->
<div class="space-y-6">
  <div class="space-y-2">…field group…</div>
  <div class="space-y-2">…field group…</div>
</div>
```

Where a separator is genuinely needed, keep it quiet: hairline width, low contrast, never combined with a large gap that already did the job.

## Keep controls distinct from content

Interactive elements need a visual signal: a background, a border, an underline, or placement in a consistent control zone such as a toolbar or footer row. A control styled identically to static text is invisible.

```html
<!-- Bad: action looks exactly like the description text next to it -->
<p class="text-zinc-600">Your trial ends soon. Upgrade now</p>

<!-- Good: the action reads as an action -->
<p class="text-zinc-600">Your trial ends soon.</p>
<button class="font-medium text-blue-600">Upgrade now</button>
```

The inverse holds too. A non-clickable badge shaped exactly like the buttons beside it collects dead clicks.

## Align to shared edges

Pick a small set of alignment edges and put everything on them, because the eye tracks straight edges to scan content.

- Every stray edge reads as noise even when nobody can name it: an icon 2px off the text edge, a card padded unlike its neighbor.
- Use one project spacing step to express hierarchy. `16px` is a useful default where no scale exists, and deeper nesting repeats the same step.
- Numbers in tables align to the trailing edge, text to the leading edge. Tabular figures are `better-typography`'s.

```css
/* Good: one shared leading edge, one indent step */
.section { padding-inline: 24px; }
.section .child { margin-inline-start: 16px; }

/* Bad: three unrelated leading edges in one column */
.header { padding-inline-start: 20px; }
.list-item { padding-inline-start: 14px; }
.footer { padding-inline-start: 24px; }
```

## Logical properties, not physical

Express direction-dependent horizontal position as leading/trailing so the layout mirrors automatically under `dir="rtl"`:

| Physical (avoid) | Logical (use) |
| --- | --- |
| `margin-left` | `margin-inline-start` |
| `padding-right` | `padding-inline-end` |
| `left: 0` | `inset-inline-start: 0` |
| `text-align: left` | `text-align: start` |
| `border-right` | `border-inline-end` |

```html
<!-- Good: Tailwind logical utilities -->
<div class="ms-4 pe-6 text-start">…</div>

<!-- Bad: breaks in RTL -->
<div class="ml-4 pr-6 text-left">…</div>
```

Reserve physical properties for things that refer to physical screen sides whatever the language, such as positioning against a device notch or matching a gesture direction.

Where arrangement encodes progression, as in star ratings, step indicators and progress bars, the sequence mirrors in RTL and stars fill from the trailing side. Flexbox and grid with logical properties mirror automatically; hand-positioned elements do not. Digit order inside numbers never reverses, which with other bidi rules belongs to `better-typography`.

## Order by importance

Readers scan top-to-bottom and leading-to-trailing. Place content accordingly:

- The most important information sits near the top and the leading edge. The further down and trailing something sits, the less attention it gets.
- Give essential information room. Never bury the one number the user came for under rows of secondary detail. Push that into collapsed sections, tabs, or detail views.
- Within a row, identifying content leads and metadata and actions trail.

```html
<!-- Good: primary fact first, detail demoted -->
<div>
  <p class="text-2xl font-semibold">$4,320.00</p>
  <p class="text-sm text-zinc-500">Available balance</p>
</div>

<!-- Bad: the key fact is buried below the fold of the card -->
<div>
  <p class="text-sm">Account 4402 · Opened 2019 · Standard tier</p>
  <p class="text-sm">Last statement: June 30</p>
  <p class="text-sm">Balance: $4,320.00</p>
</div>
```

With logical properties, the same hierarchy mirrors correctly in RTL locales.

## Don't overload the entry point

The first screenful is a table of contents, not the whole book. If everything is prominent, nothing is:

- One primary action per view. `better-colors` owns how color enforces it.
- Group secondary actions behind a menu once they exceed two or three.
- Prefer a short view that links deeper over a long view that shows everything at level one.
