---
name: variant
description: Builds multiple variants of a component you're working on and helps you iterate and pick one.
disable-model-invocation: true
---

# Variants

This skill takes one described piece of UI and builds three versions that differ on purpose. They go behind a picker in the real page, so you can flip between them and choose.

Every other skill here judges. This one produces candidates and hands the decision back. Reviewing existing UI is `interface-review` and `better-interface`, and it does not pick the winner.

## Different answers, not different tints

Three variants that differ in accent color teach nothing. You flip between them, see no real choice and the run is wasted.

So each variant is a different answer to the same brief, on an axis this collection owns:

| Axis | Owner | What varies |
| --- | --- | --- |
| Structure | `better-layout` | Grouping, order, column count, what collapses |
| Density | `better-layout` | Spacing scale, hit areas, how much fits |
| Emphasis | `better-colors` | Where filled color goes, what recedes |
| Type | `better-typography` | Scale steps, weight contrast, measure |
| Voice | `better-writing` | Labels, tone, how much copy |

Pick **one primary axis** and give each variant a different position on it. Secondary choices follow from it rather than varying on their own. A dense variant may need a smaller type step, and that is coherence, not a second axis.

Varying every axis at once produces three unattributable results. You learn which you liked, not what made it work, so the next piece starts from nothing.

## The floor every variant clears

A variant that wins on looks and fails an escalation trigger is not a candidate. It is a bug with a nice surface.

Before a variant enters the picker it clears `better-interface`'s escalation triggers. Every control has an accessible name, keyboard reaches everything a pointer does, focus is visible, nothing clips at 320px and no meaning rides on color alone.

That floor is identical across variants. It is not an axis and never trades against one. Where a direction can only work by breaking it, say so and drop the direction.

## 1. Scope one piece

One piece of UI per run. "The dashboard" is not a piece; the metric card is. Where the brief spans several, name the one the others hang off, say why and offer the rest as later runs.

Restate the brief in one sentence: what the thing is, where it renders, what it has to do.

## 2. Learn the ground

Variants have to look like they could ship tomorrow, so read what they stand on:

- The styling system, the component library and any motion library.
- The tokens: color, spacing, radius, type scale, easing.
- The product's density and voice. A dense professional tool bounds how far the boldest variant may go.
- Where the piece renders: against what background, beside which neighbours, at which widths.

With no project to read, use neutral grays, one accent and the system font stack, and say that is what you did.

## 3. Name the axis before writing code

Default to three variants. Go to five only when asked, or when the space is genuinely wide. Past five nobody compares, they scroll.

Write the set down first, a name and an axis position each. Names say what the direction is, so `Quiet`, `Editorial`, `Dense`, never `Option A`.

This step is done when no two variants share a position and you can state each one's axis in a phrase.

## 4. Build it into the real page

A variant looks fine in isolation, which is why isolation is the wrong place to judge it. Host the variants on the page that will actually contain the piece, with the real chrome, the real neighbours and realistic data.

Select with a URL search param (`?variant=quiet`), so every variant is a link you can send someone. A floating control sets it; [picker.md](picker.md) holds the spec.

Render one variant at a time, full size. Thumbnails distort spacing and scale, and spacing is usually the thing you are choosing between.

Where no page can host it, build one self-contained HTML file and keep the same picker.

Give every variant real content: product-shaped copy, plausible names and the number of items the page will really carry. Lorem ipsum and three rows make every structure look good.

## 5. Present the tradeoffs and stop

Flip through every variant yourself first. Each one renders, each interaction responds, the console is clean.

Then hand the decision over:

| Variant | Axis position | Right when | Costs |
| --- | --- | --- | --- |
| Quiet | Lowest visual weight | The page is used daily | Least memorable |
| Editorial | Largest type, most space | The moment deserves weight | Eats vertical space |

Say where the picker is running, which key flips it and which width you judged at. The answer can change between 375px and 1440px.

Never mark a favourite in the table. Asked directly, answer from how often the piece is seen and from the product's personality, not from which one you enjoyed building.

## 6. Promote one, delete the rest

On a choice: build that variant properly where it belongs, following the project's own conventions, then delete the others and the harness.

Asked for another round instead, keep the harness and run step 3 again, taking new positions around the direction you leaned toward.

Until promotion, the harness never imports from production and production never imports from the harness.

## Before you finish

| Mistake | Fix |
| --- | --- |
| Variants differ only in accent color or copy | Move one to a different position on the primary axis, or cut it |
| Every axis varies at once | Vary one; let the rest follow from it |
| Judged on a blank route | Host them on the page that will contain the piece |
| Lorem ipsum, three rows, "Jane Doe" | Real copy and the item count the page will really carry |
| The boldest variant skips keyboard or focus | Clear the floor or drop the direction |
| A favourite marked in the table | State each variant's cost and let the user choose |
| Picker restyled with the project's tokens | Keep it visibly outside the design system |
| Harness left behind after promotion | Delete it unless asked to keep it |
