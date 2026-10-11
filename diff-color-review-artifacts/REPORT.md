# OpenCode V2 diff color review — temporary fixture

[File diff color token / CSS variable inventory](COLOR-TOKENS.md)

## Location and refs

- Worktree: `/Users/usrnk1/.local/share/opencode/worktree/012780/diff-color-review`
- Branch: `diff-color-review` (local only).
- Fetched `origin/v2`: `7e42a897bc6dbbba580392d779e47137038bcafb`.
- Local baseline / HEAD: `5e14ede13c260b3b1bd2e16c5bb25722d12f366b`.
- Fixture: `diff-color-fixture/01-inline.tsx`, `02-folded.ts`, `03-prose.md`, `04-many-rows.ts`, `05-deleted.txt` (deleted), `06-added.txt` (untracked addition).
- `diff-color-fixture/README.md` is tracked and unchanged.
- Only fixtures changed. No renderer, token, behavior, formatter, push, PR, or deployment changes.

## Actual UI and how to open

The captures use the real source-backed OpenCode web app from this worktree, connected to the existing V2 background server (2.0.21). No mocked data or copied renderer. The app dev server remains available at `http://127.0.0.1:4444` and was started with `VITE_OPENCODE_SERVER_PORT=49374 bun run dev -- --port 4444` from `packages/app`. Existing app/server processes were not restarted.

Open:

`http://127.0.0.1:4444/server/aHR0cDovLzEyNy4wLjAuMTo0OTM3NA/session/ses_f085f0176ffeiNj9364c2CnHqm`

Alternatively open this session in OpenCode Desktop; its location is now this worktree. Toggle Review, choose **Git changes**, and select a fixture file. This UI calls the working-tree source “Git changes,” not “Uncommitted changes.” Use the file-tree toggle if the list is hidden. Unified/Split controls are in the review toolbar.

Captures: 1440 × 1000 CSS pixels, default OpenCode (`oc-2`) theme, system light/dark media preference. Chat pane was resized to its minimum and the file tree hidden to give the diff about 964 pixels. Wrapping was enabled by the production viewer. Close-ups below are unchanged crops of those screenshots, not re-rendered mockups.

## Representative screenshots

- [Dark inline close-up](dark-inline-closeup.png) / [Light inline close-up](light-inline-closeup.png)
- [Dark split inline](dark-split-inline.png) / [Light split inline](light-split-inline.png)
- [Dark split folded: all three bars](dark-split-folded.png) / [Light split folded](light-split-folded.png)
- [Dark unified folded](dark-unified-folded.png) / [Light unified folded](light-unified-folded.png)
- [Dark syntax and wrapped long line](dark-split-syntax-long.png) / [Light syntax and wrapped long line](light-split-syntax-long.png)
- [Dark Markdown](dark-split-prose.png) / [Light Markdown](light-split-prose.png)

Additional unified captures are in this same directory.

## Case notes

| Case | Unchanged sections | Red/green scan | Inline emphasis | Text readability |
|---|---|---|---|---|
| Single additions/deletions/replacements, adjacent rows (`01`, `03`) | Neutral background recedes; unchanged syntax can still draw the eye | Light is clearer; dark relies more on gutter bars and line numbers | Distinct but restrained | TS strings stay green even on red deletion rows, competing with change meaning |
| Contiguous versus separated edits (`01` lines 11–12; long line) | Common words inside an inline span do **not** recede | Row direction is still clear from gutter and tint | Current production `word-line` rendering joins separated edits into one broad span; multiple independent highlight islands were not available in this state | Broad wrapped emphasis adds visual weight without improving precision |
| One-character, start/middle/end edits (`01` lines 13–16; `03`) | Surrounding text remains readable | Large words are easy to find; one-character changes need deliberate attention | One-character patch is visible but easy to miss at normal scan speed | No observed loss of string readability |
| Punctuation and spaces/indent/trailing spaces (`01` lines 17–20; `03`) | Quiet surroundings | Row markers expose that something changed | Small semicolon/space blocks are visible on close inspection; blank blocks give little explanation without visible whitespace glyphs | Readable; punctuation has less salience than colored keywords |
| Isolated hunks and collapsed sections (`02`) | Neutral context recedes; three bars visible simultaneously in split | Distinct isolated rows, but dark tints are weak | Small changed-word blocks don't dominate rows | Fold-label text is unusually faint, especially dark; context comments are clearer than the fold labels |
| TS/TSX types, keywords, comments and JSX (`01`) | Syntax in unchanged rows remains fairly prominent | Pink keywords/green strings compete with the red/green layer | Emphasis is generally subordinate; the long merged span is the exception | Comments/strings/types readable overall; muted JSX words like “old,” “new,” and button text are weak on tinted/highlighted backgrounds in dark mode |
| Markdown and wrapped prose (`03`) | Plain prose is visually quieter than code | Light tints are clearer than dark | Long spans emphasize unchanged middle words as well as changes | Plain prose remains readable but looks muted; bold/heading syntax draws attention more strongly than small edit spans |
| Long/wrapped lines (`01`, `03`) | Common middle text is swallowed by merged emphasis | Tinted multi-line blocks are apparent | Broad highlights repeat across wraps and visually dominate small changes | Wrapping works in unified and split; side-by-side requires more vertical scanning |
| File beginning/end (`01`, `02`, `03`) | Neutral surrounding rows recede | Changes shown at first/last lines | Same inline behavior as middle edits | Readable |
| Dense larger file (`04`: 63 lines, 40 replacements / 80 changed rows) | **Not visually checked** | Not checked | Not checked | Fixture ready for review |
| Added/deleted whole files (`05`, `06`) | Viewer lists both with D/A badges | **File contents not visually checked** | Not checked | Fixture ready for review |
| Narrow viewport (planned 800 × 1000) | **Not checked** | Not checked | Not checked | Stopped expanding capture scope at user request |

## Specific problems to carry into a later design pass

1. Dark row backgrounds have weak separation from neutral context; syntax hue is often more salient than change direction.
2. Green string syntax appears on deleted rows too, weakening red/green semantic scanning. Pink keywords similarly attract attention independently of change status.
3. Collapsed-section labels recede too far: their subdued text is harder to read than surrounding context comments.
4. One-character, punctuation, and whitespace highlights are easy to miss without focused inspection. Their issue is subtlety/size, not overpowering brightness.
5. Muted JSX text on dark inline backgrounds is less readable than the surrounding syntax. Broad inline spans across wrapped lines add disproportionate visual mass.

The merged-span behavior is a renderer observation, not a proposed color fix. No final values selected, no fixes implemented, and no contrast-ratio compliance claim made.

## GitHub Desktop comparison boundary

The referenced discussion/image was not included in this session. A precise comparison to that direction is therefore **not verified**. As a provisional hierarchy comparison only: quiet context → recognizable changed row → localized stronger inline emphasis is the useful target. OpenCode already keeps ordinary inline backgrounds subordinate to rows, but dark row separation, syntax competition, faint fold controls, and merged broad spans weaken that hierarchy. This is not a claim that the specific GitHub Desktop reference was inspected.

Scope was intentionally stopped after the user's request to do less. No full lint/typecheck was run: these are standalone visual examples with deliberate whitespace/formatting changes, not product code.
