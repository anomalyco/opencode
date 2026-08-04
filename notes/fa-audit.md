# Farsi (fa) Localization Audit — OpenCode non-terminal surfaces

Audit date: 2026-08-02 · Base: upstream `dev` @ `1882c33827` · Repo: `anomalyco/opencode`

## Section 1 — Existing Persian / RTL PRs & issues

| ID | Title | Status | Surfaces | Notes / verdict |
|----|-------|--------|----------|-----------------|
| #37184 | docs: add Farsi (fa) translations | **OPEN** | docs (Starlight), README, glossary | Adds `README.fa.md`, `fa` locale (`fa-IR`, `dir: rtl`) in `packages/web/astro.config.mjs`, 36 docs pages under `packages/web/src/content/docs/fa/`, `.opencode/glossary/fa.md`. **Confirmed not in `dev`** (no `fa` files present). Coverage: docs/README/glossary only. **Do not duplicate.** |
| #34396 | docs: add Persian (fa) docs site localization | CLOSED (not merged) | docs, web i18n | Closed 2026-07-29 without merge. Exact same docs/fa pages + `packages/web/src/content/i18n/fa.json` + `locales.ts`. Superseded by #37184 which explicitly builds on it. **Do not re-open; leave to #37184.** |
| #33338 | feat(i18n): add Persian (Farsi) translation for app, UI, desktop, and README | CLOSED (auto-closed, never reviewed) | app, ui, desktop, README | **The exact gap this PR fills.** Auto-closed 2026-06-22 by `github-actions` for a missing PR-template section within 2h — no technical review. Files it touched: `packages/app/src/i18n/fa.ts` (1047), `packages/ui/src/i18n/fa.ts` (176), `packages/desktop/src/renderer/i18n/fa.ts` (27), `language.tsx` (+6), `desktop .../i18n/index.ts` (+6), `parity.test.ts`, `en.ts` (+1), READMEs. Our PR re-implements this correctly (template-compliant) and adds the missing `language.fa` parity entries. |
| #38079 | feat(app): support bidirectional chat text | **OPEN** | app chat, session-ui, composer | Adds `dir="auto"` for user-message text + prompt editors (legacy & v2). Content-level bidi. Already in open PR — **do not duplicate**. |
| #37249 | fix(app): correct RTL rendering for mixed Arabic/English content | **OPEN** | app chat, session-ui markdown | `rtl.ts` helpers, `unicode-bidi: plaintext`, table dir flipping, code isolation. Content-level bidi. Already in open PR — **do not duplicate** (references #35319). |
| #39423 | feat(i18n): Add Hebrew language support with RTL handling | **OPEN** | app, ui, desktop, console, stats, web, glossary | Hebrew + shared RTL infrastructure: `packages/app/src/rtl.css` (216), `language.tsx` dir/rtl (+7), `index.css` (+1), console/stats i18n, web `locales.ts`, `astro.config.mjs`, `script/translate-app.ts`. The shared RTL layout work is being built here — **do not duplicate RTL layout infra**; reference it for fa follow-up. |
| #35387 | fix(desktop): replace titleBarOverlay with custom caption buttons for RTL | **OPEN** | desktop window chrome | Desktop window-controls RTL. Separate concern; leave to that PR. |
| #36488 | fix(session-ui): escape direction:rtl bidi issue in message-part-directory via LRE/PDF wraps | **OPEN** | session-ui path display | Path/directory bidi. Leave to that PR (also closed twins #36487, #36508). |
| #38559 | feat: add RTL text support for Persian/Farsi | CLOSED | n/a | Closed; context only. |
| #33338 related README PRs | README.fa.md attempts | CLOSED | README | #28451, #25794, #31773, #31264, #33338 — all closed/unmerged. README fa is now the responsibility of open #37184. |
| #32247, #14261, #12023, #19323, #29851, #25010, #25455, #32727, #33243, #22088, #35635, #38302, #38318 | RTL / bidi / Arabic / Hebrew support PRs | CLOSED | various | Historical/closed. No merged general RTL base in `dev` today for the app UI shell (`language.tsx` sets `lang` only; never sets `dir`). |
| Issues | “RTL language support (Persian/Arabic)” (#32726 fixed by #38079; #35319 fixed by #37249), “Add RTL support in UI to Hebrew & Arabic” (related #22519 etc.) | — | — | Tracked in the open RTL PRs above. |

### What open PRs already cover (reference — do not re-implement)

- **#37184**: Docs (Starlight) `fa` locale + `dir: rtl`, 36 `docs/fa/*.mdx` pages, `README.fa.md`, language-bar links in all 22 READMEs, `.opencode/glossary/fa.md`.
- **#34396** (closed): docs fa pages + `web/src/content/i18n/fa.json` — superseded by #37184.
- **#38079 + #37249**: chat/content RTL bidi (composer `dir="auto"`, markdown bidi, tables, code isolation).
- **#39423**: shared RTL layout infrastructure (rtl.css, HTML dir) being built for Hebrew.

## Section 2 — Gap analysis (non-terminal surfaces only)

### Already merged
- Nothing Farsi-specific is merged in `dev`. Arabic (`ar`) is the only RTL locale registered in the app/desktop/web i18n systems and docs; the app UI shell does not yet set `dir` for `ar`.

### Open PRs (do not duplicate)
- Docs/README/glossary fa — #37184 (reference in PR description).
- Web/docs UI strings `fa.json`, `web/src/i18n/locales.ts`, `astro.config.mjs` fa locale — #37184 (`locales.ts` +3, `astro.config.mjs` +5-9).
- Chat/content RTL bidi — #38079, #37249.
- Shared RTL layout infra (`rtl.css`, HTML `dir`) — #39423.

### Missing but easy (implemented in this PR)
- **`packages/app/src/i18n/fa.ts`** — new full Persian dictionary (~1103 keys). Translation only.
- **`packages/ui/src/i18n/fa.ts`** — new Persian dictionary (~196 keys). Translation only.
- **`packages/desktop/src/renderer/i18n/fa.ts`** — new Persian dictionary (27 keys). Translation only.
- **`packages/app/src/i18n/en.ts`** — add `"language.fa": "فارسی"` (+1). Locale label registration.
- **`packages/app/src/i18n/{ar,br,bs,da,de,es,fr,ja,ko,no,pl,ru,th,tr,uk,zh,zht}.ts`** — add `"language.fa": "فارسی"` to each so parity holds once `language.fa` exists in `en.ts`. Locale label parity.
- **`packages/app/src/context/language.tsx`** — register `fa`: `Locale` union, `LOCALES`, `INTL` (`fa: "fa"`), `LABEL_KEY` (`fa: "language.fa"`), `loaders` (dynamic import of app + ui fa dicts), `localeMatchers` (`fa` → `language.startsWith("fa")`). Locale registration.
- **`packages/desktop/src/renderer/i18n/index.ts`** — register `fa`: import `desktopFa` + `appFa`, `Locale` union, `LOCALES`, `detectLocale`, `build`. Locale registration.
- **`packages/app/src/i18n/parity.test.ts`** — add `"fa"` to `appLocales` (desktop derives automatically). Test wiring.
- **`script/translate-app.ts`** — add `fa` to the locale registry + `"Farsi"` language name so the repo translation tooling supports fa. Tooling registration (mirrors #39423 for he).
- **`notes/fa-audit.md`** — this deliverable.

### Missing but risky (deferred — separate follow-up plan)
- **Shared RTL layout for app UI shell** (`language.tsx` `dir` handling, `rtl.css`, shell-level direction): conflict risk with open #39423. Follow-up after #39423/#37249/#38079 merge; then enable `dir: rtl` for all RTL locales (`ar`, `fa`).
- **Desktop native menu localization** (`packages/app/src/desktop-menu.ts` + `desktop/src/main/menu.ts`): hard-coded English for ALL locales today; a pre-existing gap, not fa-specific.
- **Console app fa** (`packages/console/app`: `i18n/fa.ts` ~848 keys, `lib/language.ts`, `i18n/index.ts`, RTL `dir()`): larger web surface; separate PR when ready.
- **Stats app fa** (`packages/stats/app`: `i18n/fa.ts` ~281 keys, `i18n.ts`, `lib/language`): separate PR.
- **Web session-share page fa strings** (`packages/web/src/content/i18n/fa.json`): owned by #37184/#34396.
- **Low-level bidi rendering** in terminal/TUI: outside scope (excluded).

## Implementation notes

- Commit 1: translations + locale registration (all files above except RTL).
- Commit 2 (deferred to follow-up): RTL/layout — because shared RTL infra is actively in open PRs (#39423).
- Technical content (commands, flags, code, URLs, model IDs, config keys, `{{placeholders}}`) preserved verbatim per `.opencode/command/translate.md`.
- Use Persian glyphs `ک`/`ی`, never Arabic `ك`/`ي`.