---
name: better-writing
description: Focuses on improving product copy in your project.
---

# Interface writing

Clear and brief beats clever; consistent beats varied. The best error message is the interaction redesigned so the error cannot happen.

How copy renders (capitalization via `text-transform`, truncation, smart punctuation) belongs to `better-typography`. Error markup and announcements (`aria-invalid`, live regions) belong to `better-accessibility`. Room for translated strings belongs to `better-layout`.

## Recon the existing voice

Before writing or reviewing, read the copy nearby. Note the product's terminology, its localization conventions and any voice or content style guide.

A deliberate brand voice is not a defect. Raise a departure from plain language only when it creates inconsistency, ambiguity, translation risk, or a tone the stakes don't support.

## One voice, flexible tone

The product has one voice and its existing copy establishes it. A local edit does not get to invent a new one. Keep terms consistent: if it's "Archive" in the menu, it isn't "Move to storage" in the toast. Tone flexes with the stakes:

| Context | Tone |
| --- | --- |
| Success, onboarding, empty states | Warm, can be light |
| Routine actions, settings | Neutral, minimal |
| Errors, destructive confirmations | Calm, plain, zero playfulness |
| Data loss, security | Serious, explicit |

## Address the reader directly

In instructional copy, write "you", not "the user". In errors, "we" invites ambiguity and reads as deflection, so prefer "Unable to load content" over "We're having trouble loading this content". An established first-person voice can stay in low-stakes copy where it still reads clearly.

Use possessives sparingly: "Favorites" beats "Your Favorites". Hold one perspective throughout a flow.

## Plain words over clever ones

Choose words a tired reader gets on the first pass, and delete every word that does no work. No idioms, no colloquialisms, no humor that won't translate.

Skip unnecessary gender: "Subscribers can post recipes", not "each subscriber can post his or her recipes". Match the input device: "tap" on touch, "click" with a pointer, "select" when both are possible.

Never assemble a sentence from fragments around a variable (`"You have " + n + " new messages"`), because word order changes per language. Use a full templated string with proper pluralization.

## Verb-first buttons

A button label starts with a verb naming the action: "Send", "Save draft", "Delete project". Never "OK!", "Let's go!", or a bare "Yes" and "No" on a consequential action.

A confirmation button repeats the consequence, so the dialog is answerable without reading the body. "Delete this project?" offers `Delete project` and `Cancel`.

## Consistent flow vocabulary

A multi-step flow uses one vocabulary throughout: "Get started" to enter, "Continue" or "Next" (pick one) to advance, "Done" to finish. Alternating synonyms makes users wonder whether the buttons do different things.

## Links describe their destination

Link text has to make sense out of context, because screen-reader users navigate by a list of the page's links. Write "Read the billing docs". "Click here" fails this and the device-verb rule at once.

A bare "Learn more" breaks down as soon as two appear on one page. Suffix each one: "Learn more about exports".

## One capitalization policy

Pick title case or sentence case per element type, then apply it to every instance of that type. Sentence case is the safer default. It is calmer, has no per-word rules to remember and localizes cleanly. "Save Changes" beside "Discard changes" reads as sloppiness.

## Settings describe the ON state

Label a toggle for what happens when it is on. "Send read receipts" lets users infer the off state; the negative ("Don't send read receipts") turns the toggle into a double negative.

Link straight to a referenced setting rather than describing the path to it: a "Notification settings" link, not "Go to Settings > Notifications > Email".

## Errors say how to fix, next to where it broke

An error is an instruction, and it belongs beside the field that failed:

| Bad | Good |
| --- | --- |
| That password is too short | Choose a password with at least 8 characters |
| Invalid name | Use only letters for your name |
| Oops! Something went wrong. | Unable to save. Check your connection and try again. |

No blame, no "oops", no exclamation marks. Phrase hints positively ("Use only letters", not "Don't use numbers or symbols") and show them before the mistake, not after. When the same error keeps firing, redesign the interaction instead of rewording it.

## Empty states point forward

An empty state says what this place is, how to fill it and offers one clear next action:

```html
<!-- Bad: a shrug -->
<p>No results.</p>

<!-- Good: orientation plus a next step -->
<p class="font-medium">No projects yet</p>
<p class="text-sm text-zinc-500">Projects keep your tasks and files together.</p>
<button class="mt-4">Create a project</button>
```

A search or filter empty state names the query and offers an exit: "No results for 'quarterly'. Clear filters". Never park persistent information in an empty state. It disappears the moment content exists.

## Placeholders are examples, not labels

A placeholder shows the expected format: `name@example.com`, `DD/MM/YYYY`. It vanishes on input, so it is never the only label. Every field keeps a visible one.

## Reporting

**Severity.** `HIGH` misleads the user or hides how to recover from an error. `MEDIUM` breaks voice, terminology, or capitalization consistency. `LOW` is isolated wording polish.

**Verification.** Source alone is enough here. Check every label against the action it invokes, every error for a stated fix and terminology against the copy around it. No browser check is required.

**Format.** Group findings under the principle each violates, ordered by severity, one row per root cause listing every location it appears in:

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |

`Location` is `path/to/file:line`. `Why` names the principle and the user impact.

End with `Block` when any `HIGH` remains, `Approve` otherwise, leaving the rest in the table as work to do. Never `Approve` coverage you did not inspect. With nothing to report, state "No actionable writing findings" and report verification.
