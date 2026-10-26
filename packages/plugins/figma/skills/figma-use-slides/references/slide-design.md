# Slide Design Principles

> Part of the [figma-use-slides skill](../SKILL.md). Design guidance for creating visually compelling, varied slide decks that meet the expectations of a design-literate audience.

## Contents

- Color
- Type
- Content density
- Layout
- Shape language and motifs
- Composition
- What to avoid


## When you're editing an existing deck

These principles describe what to *choose* when building from scratch. When editing an existing deck — adding a slide, reworking a section, changing colors — they describe what you're *matching*. Inspect the deck first: its palette, type choices, spatial habits, and motifs are the design language. Your job is to stay consistent with it, not to introduce new principles from this document that conflict with what's already there. Only reach for these principles to fill gaps the existing deck doesn't answer.

## When the user supplies a design direction

Everything below is guidance for designing from scratch. When the user provides brand guidelines, a color palette, typography specs, or a reference file, those inputs take precedence over the principles here. A user who says "our brand uses Helvetica and a navy/gold palette" has already made the type and color decisions — the guidance in this document applies to the decisions they *haven't* made (layout variety, composition, spatial pacing, content density).

The principles here still matter even when working within brand constraints — a branded deck still needs clear hierarchy, varied layouts, and deliberate composition. But "let one color lead" means let the user's primary brand color lead, not a color you chose. "Choose typefaces that match the deck's voice" means work within the brand's type system, not introduce a new one. Read each principle below through the lens of the user's inputs: where they've decided, follow; where they haven't, these principles guide you.


## Color

**Let one color lead.** A palette works when there's a clear protagonist — one hue that owns the majority of the visual real estate, supported by a secondary tone and punctuated by an accent. When every color gets equal stage time, the result feels indecisive.

**Make the palette earn its place.** The colors should feel like they belong to *this* presentation's subject matter. A deck about infrastructure reliability and a deck about a brand campaign shouldn't look like they share a Figma library. React to the content.

**Think about the deck's tonal arc.** Dark slides hit differently than light ones — use that. A common structure is to bookend the deck (title + closing) with darker, more atmospheric slides and keep the middle lighter for readability. But going all-dark or all-light is fine too, as long as it's a choice and not an accident.

**Treat backgrounds as a design surface.** A background isn't just "the thing behind the content." Gradients, color fields, soft geometric forms near the edges, or tonal shifts between sections all create mood and guide the eye without fighting the foreground.

**Readability is non-negotiable.** Body text on dark backgrounds must be high-contrast — close to white, not muted or tinted. Reserve brand/accent colors for headings, labels, and shapes. If you squint and can't instantly read the body copy, the contrast is too low. A beautiful palette that people can't read is just decoration.


## Type

**Choose typefaces that match the deck's voice.** Use `listAvailableFontsAsync()` to see what's installed — there are far more options than the usual defaults. A display face for headings paired with a workhorse for body copy gives the deck a distinct personality. Vary your choices between decks; don't converge on the same pairing every time.

**Make the hierarchy unmissable.** If someone squints at a slide from across the room, the title should still be the loudest thing. That means real scale difference — not a polite step between levels. A title should dominate the slide; body text should clearly defer to it.

**Align body copy to the left.** Centered paragraphs and bullet lists are harder to scan. Reserve center-alignment for titles, pull quotes, and single-line statements. Everything else should have a clean left edge.

**Use weight as a design tool.** Light, regular, semibold, and bold aren't just for emphasis — they shape the texture of a slide. A thin display title over heavy body text creates a very different mood than a bold slab heading with lightweight supporting copy.


## Content density

**Slides are not documents.** A slide exists to land one idea with visual impact — not to exhaustively cover a topic. The moment you're fitting "everything important" onto one slide, you've switched from designing a presentation to writing a report. Resist the urge.

**The test is simple: can someone absorb this slide in a few seconds?** If a slide requires careful reading, it has too much content. Presentations move at a pace the speaker controls — not the reader. Every element on a slide should be graspable at a glance. If it can't be, the content needs to be cut or split across slides.

**Your job is editorial.** When adapting source material into slides, deciding what to *leave out* is more important than deciding what to include. Every point you cut makes the remaining points stronger. A slide with one bold insight and generous whitespace lands harder than a slide with six good points crammed together. Bullet lists, comparison tables, and multi-column layouts all share the same trap: they make it easy to keep adding items because there's always room for one more row. The question is never "does it fit?" — it's "does each item earn its place at the cost of the others' impact?"

**More slides, not denser slides.** If content feels important but won't fit without crowding, the answer is splitting it across two well-composed slides — not shrinking the font or tightening the spacing. Slides are free; attention is not.


## Layout

**Derive layout from content, don't select from a menu.** Every slide has a rhetorical purpose — introducing an idea, proving a point, creating a pause, delivering a punchline. The layout should emerge from that purpose. A single key metric wants to be huge and surrounded by space. A comparison wants visual separation that reinforces the contrast. A turning point wants restraint and emptiness. Start with "what is this slide *doing*?" and let the spatial arrangement follow.

**Interesting layouts come from imbalance, not symmetry.** A 50/50 split is stable but static. An 70/30 division creates visual direction — the eye moves from the larger zone to the smaller one. Uneven distributions of content and space generate the tension that makes a composition feel designed rather than default. This applies to everything: how you divide the canvas, how you weight text against empty space, how you size elements relative to each other.

**The relationship between elements carries meaning.** Whether content is overlapping, adjacent, nested, or isolated changes how it reads. Elements that overlap feel connected and layered. Elements separated by generous space feel independent and important. Elements pushed to the edge feel dynamic and cropped — like you're seeing part of a larger composition. Think about what the spatial relationship *says*, not just where things fit.

**Vary structure across the deck.** The quickest way to make a deck feel automated is to repeat the same spatial structure on every slide. If you step back and every slide has the same content placement — heading top-left, body below, supporting content in a grid — the deck has a mechanical rhythm regardless of how different the content is. Each slide should feel like a fresh composition, not a filled-in template. This means varying where content anchors (left, right, center, edge), how the canvas is divided (or not divided), and how much of the slide is occupied vs. left open.

**Use the full 1920×1080 canvas.** Content that huddles in the center with uniform margins wastes the most impactful real estate: the edges. Shapes that bleed off the canvas, headings anchored to corners, color fields that extend to the frame boundary — these make the slide feel like a window into a larger world rather than a bordered container.

**Plan the layout sequence before building.** Before writing any code, decide the spatial strategy for each slide. If the sequence feels repetitive when described in words — "grid, grid, two-column, grid, two-column" — it will feel repetitive visually. Rearrange and diversify before you start building. This is far cheaper than rebuilding slides later.

**Pacing matters as much as individual layouts.** A deck needs rhythm — moments of density followed by moments of openness, dark slides followed by light ones, information-rich layouts followed by slides with a single idea and nothing else. These quieter slides aren't filler; they're the pauses that give the dense slides their impact. Without them, every slide competes equally for attention and none of them win.


## Shape language and motifs

**Add at least one non-text element per slide.** A shape, a line, a filled rectangle, an accent circle, a decorative border — something that gives the eye a resting point and adds structure. All-text slides disappear from memory instantly.

**Pick a recurring visual element and repeat it.** Cohesion across a deck comes from repetition with variation. Choose one signature treatment and thread it through the deck. A good motif is recognizable (you'd spot it out of context), repeatable (it works across different slide types without forcing the layout), and varied in application (same element used differently — cropped on one slide, full on another, large here, small there). The motif itself can be anything — a shape, a line treatment, a layering convention, a spatial rule — as long as it's distinctive enough to feel like a deliberate throughline.

**Use shapes structurally, not just decoratively.** Rectangles can be content containers, section dividers, background panels, or callout frames. Lines can separate regions, connect ideas, or create visual rhythm. Circles can anchor icons or draw focus to key numbers. Shapes are layout tools as much as visual ones.

**Commit to your motif — don't hedge with low opacity.** A recurring shape at 4–6% opacity is invisible; it's a gesture toward design without actually making a design decision. If you choose a circle motif, make it visible — large enough to crop off an edge, opaque enough to register as a deliberate element. If a shape wouldn't be missed if you deleted it, it's not pulling its weight.


## Composition

**Let things be off-center.** Symmetric, perfectly centered layouts are stable but static. Shifting a content block to the left third of the slide, or pushing a shape cluster toward the upper-right corner, creates movement and makes the composition feel considered rather than default.

**Layer elements for depth.** A colored rectangle behind a text block, an accent shape that partially overlaps a content boundary, a decorative element that bleeds off the canvas edge — these overlaps add dimension and make the slide feel like a composed scene instead of a flat arrangement of objects.

**Commit to density or openness.** A slide with a single insight surrounded by white space feels intentional. A slide with a tightly packed comparison grid feels intentional. A slide that's vaguely populated — neither spacious nor dense — just feels unfinished. Pick a gear and stay in it.

**Push toward the edges.** Elements near the edges of the canvas create tension and energy. A color block bleeding off the left side, a title anchored to the top-left corner, a decorative shape cropped by the bottom edge — these make the slide feel like a window into a larger composition rather than a bordered frame.

**Vary your anchor points.** If every slide starts its content at the same x/y position with the same margins, the deck develops a mechanical rhythm regardless of how different the content is. Shift the anchor — one slide starts content in the upper-left, the next centers a single element, the next pushes a heading to the right third. The variation should feel intentional, not random, but it should be *present*.


## What to avoid

These patterns signal that a deck was generated without design intent. Actively steer away from them:

- **Identical structure on every slide** — title centered at top, bullet list below, slide after slide. Rotate between different layout patterns.
- **Safe, noncommittal color** — everything in muted gray-blue with no clear primary or accent color. Take a stand on the palette.
- **Text-only slides** — no shapes, no visual structure, no spatial interest. Every slide needs at least one non-text element.
- **Centered everything with matching margins** — nothing approaches the edges. Let elements anchor to corners, push into margins, or bleed off the canvas.
- **A line under every heading** — this is a tell. Separate sections with space, color changes, or layout shifts instead.
- **Flat hierarchy** — all text within a narrow size range (18–24pt) with no clear visual priority. Headlines should be dramatically larger than body text.
- **Same typeface on every deck** — choosing the same "safe" font regardless of context. Match type choices to the deck's personality and vary them between projects.
- **Plain backgrounds throughout** — every slide the same flat color with nothing in the background layer. Even subtle treatments — a gradient, a soft shape, a tonal shift — add presence.
- **Even spacing everywhere** — no rhythm, no grouping, no visual pacing. Related items should cluster tightly; important ideas should have room around them.
- **One container shape for everything** — when every piece of content lives inside a slightly-tinted rounded rectangle, the deck becomes a grid of containers regardless of what's inside them. Not every piece of content needs a box around it. A pull quote can just be big italic text. A stat can just be a number. A comparison can be spatial separation rather than two columns of cards. Reach for a container only when grouping genuinely serves the content, not as a default wrapper.
- **Identical layouts with swapped colors** — when comparing two subjects, it's tempting to make structurally identical slides with different accent colors. This signals that you ran the same template twice. Give each subject a distinct composition — the visual difference reinforces the conceptual difference.
- **Sacrificing legibility for mood** — muted, tinted, or low-opacity body copy on dark backgrounds might look "designed" at a glance but fails the actual job of being read. Body text exists to be read. Use color expressively on headings, labels, and shapes — not on the text people need to absorb.
- **Too much content with nice typography** — dense comparison tables, long bullet lists, and multi-paragraph slides don't become good slides just because the font is beautiful. Good typography doesn't fix bad editorial choices. Cut the content first, then design what remains.
- **Same spatial starting point on every slide** — when every slide anchors content to the same position with the same margins, the deck develops a mechanical rhythm that undermines any other variety you've built. Vary where content lives on the canvas from slide to slide.
- **Decorative elements that wouldn't be missed** — shapes placed as "atmosphere" that are too small, too faint, or too generic to register as intentional. If removing an element wouldn't change how the slide reads, it's not contributing. Decorative elements should be bold enough that their presence is a deliberate design choice.
