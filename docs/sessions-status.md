# Sessions screen: status model, icons, and decisions

Design record for the cross-project sessions list (`opencode sessions`). It
covers the status state machine, the icon/color language, and the product
decisions taken with the maintainer. Implementation lives in:

- `packages/core/src/session/status-store.ts` — persisted statuses (SQLite `session_status` table)
- `packages/opencode/src/session/status.ts` — runtime → persisted mirroring (serialized write queue)
- `packages/opencode/src/session/status-derive.ts` — writer-liveness derivation
- `packages/tui/src/util/session-status.ts` — status resolution, labels, icons, colors
- `packages/tui/src/routes/sessions.tsx` — the screen itself

## Status states and icons

Every row may carry a gutter icon and a footer label that share one color.

| Icon | Label | Meaning | Set when | Expires |
|------|-------|---------|----------|---------|
| spinner | `Working` | A turn is running in a live process | runtime busy, or persisted `working` with a live writer PID | becomes `✕ Interrupted` when the writer dies |
| `⚠` | `Retrying` | The provider call is being retried | runtime retry, or persisted `retrying` with a live writer PID | same as above |
| `!` | `Needs input` | A question/permission **tool** is blocked waiting for you | `question.asked` / `permission.asked` (runtime always wins) | never — clears when you reply; becomes plain idle if the writer dies |
| `?` | `Waiting` | The turn **completed** with the assistant's last line asking you something | `setIdle` heuristic: completed assistant message whose last text line ends with `?` | never — fades but stays until you reply |
| `✓` | `Done` | The turn completed without asking anything | `setIdle`: completed assistant message, no trailing `?` | label/icon disappear after 30 min |
| `✕` | `Interrupted` | The process behind an active status is gone | derived at read time: persisted `working`/`retrying` with a dead writer PID | rewritten on the next real transition |
| — | (none) | Idle or nothing to say | everything else | — |

Precedence (highest first): runtime pending question/permission → runtime
busy/retry → persisted row. The persisted `detail` shows next to the title:
the question for `Waiting`, the question header for `Needs input`, the first
line of the last reply for `Done`, the retry reason for `Retrying`.

## Color bands ("cache heat")

Colors communicate how long ago the status last changed, aligned with
provider prompt-cache windows so hot sessions stand out:

| Age | Rendering |
|-----|-----------|
| < 5 min (inside the default cache TTL) | strong type color (warning/success/primary/error) |
| 5–60 min (extended-cache window) | color tinted ~55% towards the background |
| > 60 min | muted gray |

Terminals cannot vary glyph size, so "fading over time" is expressed through
color intensity plus, for `Done`, expiry. `Waiting` and `Needs input` never
expire — a pending reply should never silently vanish.

## Decisions (discovery, 2026-07-27)

All recorded in the discovery session
`~/.agents/skills/discovery-interview/scripts/discovery-sessions/28efc353-f6bf-494a-a3c3-878d48d28c3f`.
Every recommendation was accepted:

1. **Detection of "waiting for the user"**: heuristic — the completed turn's
   last non-empty text line ends with `?`. Cheap (runs where the `Done`
   detail was already computed), covers the reported case, and false
   positives are low-cost (a `Done` shows as `Waiting`).
2. **Label**: `Waiting` — reads as "your turn" without colliding with
   `Needs input` (blocked on a tool).
3. **Indicator placement**: gutter icon for every status, next to the
   existing spinner slot; the footer keeps the text label.
4. **Time bands**: 3 bands — `<5min`, `5–60min`, `>60min` — matching the
   default and extended prompt-cache TTLs.
5. **Aging on the icon**: color intensity (typed glyphs have no meaningful
   "fill" axis; size does not exist in a terminal).
6. **Glyph set**: plain Unicode — `? ! ✓ ⚠ ✕` + the existing spinner.
   No Nerd Font dependency.
7. **`Waiting` expiry**: never; it only fades, like `Needs input`.

Related earlier decisions: status writes are serialized through a single
queue (no lost updates), writers stamp their PID and readers derive
`Interrupted` from writer liveness (no false "interrupted" for sessions
alive in other terminals), and question/permission finalizers persist the
runtime status so dropped requests don't leave stale `Needs input` rows.

## Future: LLM-based turn classification (investigated, not implemented)

The `?` heuristic is a stand-in for semantic classification. Feasibility was
tested on this machine (2026-07-27): a local **Ollama `qwen3:4b-instruct`**
classified three real examples (pt-BR question, pt-BR conclusion, English
decision prompt) **3/3 correctly in ~100–150 ms per call** with
`num_predict: 10, temperature: 0`. The prompt was a single instruction to
reply `WAITING` or `DONE`.

Viable integration paths, in increasing effort:

1. **Small cloud model through the existing provider infra** — opencode
   already resolves a "small model" per provider for title generation
   (`provider.getSmallModel`, used in `session/prompt.ts`). The classifier
   could run on `setIdle` with the same resolution. Costs one tiny API call
   per completed turn; works on any machine with a configured provider.
2. **Optional local model via Ollama** (`http://localhost:11434`), enabled
   by config, with the `?` heuristic as fallback when Ollama or the model
   is absent. Zero marginal cost, ~150 ms, works offline; requires the user
   to run Ollama with a small instruct model.
3. **Hybrid**: heuristic first (synchronous, free), then an asynchronous
   LLM recheck that rewrites the row only when it disagrees. Needs care
   with the write queue ordering, but converges to high accuracy without
   blocking the turn.

Classification could later grow beyond two labels (e.g. distinguishing
"blocked on a destructive decision" for a stronger highlight) without
changing the persisted schema — only the writer's mapping changes.
