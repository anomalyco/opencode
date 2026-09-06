---
name: better-typography
description: Focuses on type scale, spacing, sizing, variable fonts, OpenType features, wrapping, truncation and other details that make typography feel great across your product.
---

# Typography

Typography is mostly restraint: a sensible scale, comfortable spacing, enough contrast. A label, a table cell, a marketing headline and an article paragraph do not share one set of rules.

When reviewing, read the rendered page instead of scanning the code. Bad wrapping, widows and truncation only show up at real content lengths.

Write every fix in the project's styling system, and use the exact values below rather than familiar-looking equivalents. The [cheat sheet](css-cheat-sheet.md) maps each declaration to its Tailwind equivalent.

The words themselves belong to `better-writing`. Semantic heading structure belongs to `better-accessibility`. Spatial RTL layout and logical properties belong to `better-layout`. Contrast measurement belongs to `better-colors`. This skill owns how text renders, wraps and behaves in mixed-direction content.

## Serve the right format

Use `.woff2` on the web, for Brotli compression and broad support. `.woff` is a fallback for very old browsers. `.ttf` and `.otf` are desktop formats with no web compression. How the files load is the project's concern.

## Properties over raw tags

When a CSS property exists, use it. `font-weight: 650` instead of `font-variation-settings: "wght" 650`. `font-optical-sizing: auto` instead of `"opsz"`. `font-variant-numeric: tabular-nums` instead of `font-feature-settings: "tnum" 1`.

Properties keep working when a non-variable fallback renders. Reserve raw tags for custom axes (`"GRAD" 80`) and niche features (`"ss01" 1`) with no property of their own. Axes and feature tags are listed in [variable-fonts-and-opentype.md](variable-fonts-and-opentype.md).

## Load intended weights and styles

Browsers synthesize a weight or style the active family doesn't provide, distorting the real face. Load the faces the design uses.

`font-synthesis: none` turns synthesis off, but it erases emphasis rather than reporting it. Set it only after checking every required bold, italic, small-cap, superscript and subscript form stays distinct across the fallback stack.

## Fewer fonts, sizes and weights

Rarely use more than three fonts. Weight and size define hierarchy; overusing them hurts readability fast. Pair for contrast, not similarity: a serif headline over a sans body reads as deliberate, two near-identical sans-serifs read as a mistake.

Below `18px`, stay at weight `400` or heavier. Weights under `300` are display-only at `28px`+; they disappear at text sizes. Pairing guidance is in [choosing-fonts.md](choosing-fonts.md).

## Use a type scale with semantic names

Define a small set of sizes and deviate from it as little as possible. Hard-coded sizes with no system behind them break down at scale.

Solo, default names like `text-sm` are fine when the usage rules are clear. On a team, name sizes by use (`text-body-sm`) so the rules survive other people. Scale construction is in [spacing-and-sizing.md](spacing-and-sizing.md).

## Heading sizes descend with level

Map heading levels to descending steps of the type scale, so a visually subordinate heading never overpowers its parent. Adjacent levels may share a size toward the small end of the scale, as long as weight or spacing keeps them distinct. The semantic element is `better-accessibility`'s; this skill sets only the visual treatment.

## Line-height by role

Headings tighter, around `1.1`. Body copy `1.5` to `1.6`. Prefer unitless values, so line-height scales with the font size; a fixed `24px` does not.

Tight line-height is for short text. Anything that wraps to three or more lines needs at least `1.4`, even in a height-constrained row.

## Letter-spacing by size

Large headings often look better with slightly negative letter-spacing. Small uppercase labels need a little positive letter-spacing, or the letters feel crowded. Body copy at reading sizes needs neither.

## Cap the measure

Long lines make it hard for the eye to find the next one. Cap long-form text around 60–75 characters per line. Any unit works, as long as a cap exists and the line length lands in range. See [unit choices and the pixel equivalents](wrapping-and-punctuation.md#measure-line-length).

## Wrap deliberately

Four declarations, four jobs:

- `text-wrap: balance` distributes text evenly across lines. Use it on headings.
- `text-wrap: pretty` stops a single short word landing on the final line. Use it on descriptions.
- `overflow-wrap: break-word` where a long word, link, or ID could escape the container.
- `white-space: nowrap` on labels and badges where a line break looks broken.

Skip `balance` and `pretty` in long-form text.

## Tabular numbers on changing values

Digits have different widths by default, so timers, counters and prices shift the layout as they update. Apply `font-variant-numeric: tabular-nums` to any value that changes.

## Truncate without losing content

For a single line, `text-overflow: ellipsis` with `overflow: hidden` and `white-space: nowrap`. For several, `line-clamp`. Truncation hides content. When the missing text matters, keep the full value reachable in a tooltip or an expanded view.

## Write copy naturally, style with CSS

Store text in natural case and control presentation with `text-transform`, so a redesign never means rewriting copy.

Use smart punctuation in rendered text:

- Curly quotes in prose, straight quotes in code.
- An en dash for ranges: `2010–2020`.
- The single ellipsis character, not three periods.
- `&nbsp;` to hold `16 px` together across a line break.
- `&shy;` to say where a long word may break.

## Underlines from the font

Default underlines sit wherever the browser decides. Pull position and thickness from the font's own metrics with `text-underline-position: from-font` and `text-decoration-thickness: from-font`. Tune by hand with `text-decoration-thickness`, `text-underline-offset` and `text-decoration-skip-ink`.

`text-decoration-style` draws the line dotted, dashed, or wavy. A dotted underline is a common hint that a word carries extra information, such as an abbreviation or a defined term.

Color is the only part of a real underline that animates reliably. So unless the only thing animating is the color, build the underline as a separate element rather than using `text-decoration`.

## Inputs at 16px on mobile

iOS Safari zooms the whole page when an input's text is smaller than `16px`. Two fixes hold the size at `16px` and look different, so ask which one the design wants:

- Size the input up on mobile (`text-base sm:text-sm`). Changes how it looks on small screens.
- Keep `font-size: 16px` and render the intended size with `transform: scale()`, compensating width and `line-height`. Identical at every viewport, more code to maintain.

Both recipes are in [details-and-accessibility.md](details-and-accessibility.md).

## Size and contrast floors

Start long-form body text at `16px`, the browser default. Move off it only for a reason you can name: the typeface runs small, the measure is narrow, or the product is a dense professional tool.

UI text can go smaller. `14px` is a useful starting point for inputs and menus, `13px` for captions and rarely below `12px`. Inputs still need `16px` on mobile.

When text looks low-contrast, use `better-colors` to measure the rendered pair and `better-accessibility` to classify the requirement. Leave the colors alone unless asked.

## Font smoothing on the root

On macOS, text renders heavier than intended. Apply `-webkit-font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale` once on the root layout, never per component. Tailwind's `antialiased` covers both.

## Language and bidi behavior

Set `lang` so browsers and assistive technology pick the right pronunciation, quotes and hyphenation. Set `dir` at the document or at the content boundary where direction changes. Preserve digit order, and use `<bdi>` to isolate a mixed-direction value. Spatial mirroring and logical CSS properties belong to `better-layout`.

## Keep useful text selectable

Keep text selectable by default. `::selection` can carry brand into the reading experience, as long as the selected combination stays legible.

`user-select: none` belongs on a draggable or gesture-driven surface where accidental selection interferes. Never across the interface and never because a button label can be highlighted.

## Before you finish

| Mistake | Fix |
| --- | --- |
| Synthesized face differs from the design | Load the real face; disable only the verified synthesis mode |
| Child heading visually overpowers its parent | Map that section's hierarchy to descending scale steps |
| Heading element picked for its default size | Choose semantics first, then set the size in CSS |
| Orphan on the last line of a paragraph | `text-wrap: pretty` |
| Lopsided two-line heading | `text-wrap: balance` |
| Justified text in an interface | `text-align: start`; reserve justify for specific editorial layouts |
| Underline cuts through descenders | `text-decoration-skip-ink: auto`, `from-font` metrics |
| Mixed-direction value renders in the wrong order | Correct `lang`/`dir`; isolate the value with `<bdi>` |
| Selection disabled across application chrome | Restore it; suppress only where it conflicts with a drag or gesture |
| Extra-info hint with no visual cue | Dotted underline via `text-decoration-style: dotted` |
| Thin/Light weight on `14px` UI text | Weight `400`+ below `18px`; thin weights are display-only |
| `leading-none` on a three-line card description | At least `1.4` on any text that wraps to 3+ lines |

## Reporting

**Severity.** `HIGH` makes text unreadable or truncates content with no way to recover it. `MEDIUM` breaks the type system or the heading hierarchy. `LOW` is isolated polish.

**Verification.** Without a browser: computed size and weight for each heading level, checked descending; declared line-height and measure; truncation rules against realistic string lengths. With one: resize the viewport to catch wrapping, widows and truncation at real content lengths. Report every check you could not run as `Not verified`.

**Format.** Group findings under the principle each violates, ordered by severity, one row per root cause listing every location it appears in:

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |

`Location` is `path/to/file:line`. `Why` names the principle and the user impact.

End with `Block` when any `HIGH` remains, `Approve` otherwise, leaving the rest in the table as work to do. Never `Approve` coverage you did not inspect. With nothing to report, state "No actionable typography findings" and report verification.
