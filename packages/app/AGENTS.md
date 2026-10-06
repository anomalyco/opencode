## Priorities

- Prioritise, in this order: stability, simplicity, performance.
- Before changing session or timeline code, record a production benchmark baseline and compare it after the change.

## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from the repository root): `bun dev serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Typography

- Use `--line-height-compact` (`16px`) for `13px` compact UI text and `--line-height-base` (`20px`) for body text.
- Do not use `leading-none`, `line-height: 1`, or a `13px` line height for normal text. Inter descenders clip inside truncation and overflow containers.
- Keep control and row heights explicit. Fix font metrics directly rather than using transforms, negative margins, or clip-padding compensation.

## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for visible copy, placeholders, accessible labels, tooltips, menus, dialogs, toasts, empty states, and displayed errors.
- Feature work adds English source strings only. Leave non-English keys absent so the runtime English fallback applies; translations land separately after language review.
- Render count-sensitive copy only through `language.plural(baseKey, count, params)`. Never select or pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `language.t(...)`.
- When migrating existing copy to i18n, preserve the English text byte-for-byte unless the task explicitly requests a copy change.
- NEVER change existing English text or English keys to facilitate translation. English is intentional, designer-written source copy; adapt locale-specific translations and i18n mechanics around it.
- Keep locale complexity behind the shared typed i18n APIs. Feature and component code should use `language.t(...)` for ordinary copy and `language.plural(baseKey, count, params)` for count-sensitive copy. It must not inspect the locale, call `Intl.PluralRules`, construct or select plural-category keys such as `.one` or `.other`, or branch on locale-specific grammar.
- Do not compose translated count phrases or sentence fragments in feature components. Add a focused language-context operation that owns plural selection and composition when one UI concept needs coordinated keys.
- Prefer complete translated phrases. Do not concatenate grammatical fragments or make call sites assemble sentences. Keep placeholders to irreducible dynamic values such as names, paths, and counts.
- If a translation cannot be expressed by the current API, deepen the shared language/UI i18n module so one typed call owns locale selection, plural resolution, fallback, and interpolation. Do not leak that machinery into product code.
- Do not translate from model knowledge alone. Verify terminology and grammar with Unicode CLDR locale/plural data, Microsoft Localization Style Guides and terminology, Apple localization/style guidance and localized platform UI, Mozilla localization style guides, Mozilla Pontoon, and the Firefox localization corpus at `github.com/mozilla-l10n/firefox-l10n`.
- For developer-facing terminology, prefer the words already used by the target language's developer community over literal dictionary translations. Cross-check maintained localized developer products such as Firefox, KDE, and VS Code; use at least two independent corpora when they are available. If established practice keeps an English loanword or acronym, keep it rather than inventing a translation.
- Translate complete UI phrases in context. A glossary hit is evidence, not permission to translate word-by-word. Check terse labels such as session, prompt, agent, model, fork, shell, terminal, workspace, and worktree in the same grammatical role before choosing a term.
- Before a locale is ready, audit recurring concepts for one consistent translation and review every value that still equals English. Classify retained English as a product name, provider/tool name, URL, code token, keyboard legend, acronym, asset name, or established borrowing; translate unexplained leftovers.
- In translation review notes, name the corpora used and call out uncertain or region-specific terminology so native speakers can focus review where it matters.
- Also use the relevant language authority or official dictionary for the locale (for example RAE/Fundéu, FranceTerme, Duden, TDK, Kotus/Kielitoimiston sanakirja, Språkrådet/Bokmålsordboka, Rada Języka Polskiego/PWN, the Russian and Arabic language academies, the Ukrainian Orthography, Taiwan MOE dictionaries, or the Royal Society of Thailand). Treat the English dictionary as the semantic source of truth and preserve placeholders, code identifiers, product names, and keyboard labels.

## Tests

A test must pay for its upkeep. Before adding one, answer three questions: which observable contract does it protect, which credible regression makes it fail, and why does no existing test already catch that regression. If any answer is missing, do not add the test.

- One contract, one owner. Test each behavior once, at the strongest boundary that observes it: the area's e2e keeper suite, or the owning module's unit test. Extend an existing table or keeper case before creating a file.
- Do not unit-test what an e2e keeper already proves, what a dependency does (for example `@pierre/trees`), config that passes values through, or source text (import or string greps). Source text is fair game only when that text is the contract, such as a persisted key.
- Never add production seams for tests: no test-only exports, parameters such as `now`, `delay` or `budget`, flags, globals, or `data-*` attributes. Control time with `setSystemTime` from `bun:test` and drive the real entry point.
- A test must be able to fail. Do not assert values the code under test produced, mock the behavior you assert, use soft assertions for the order the test guards, or leave `rejects`/`resolves` un-awaited. A regression test must fail on the code before the fix.
- Do not repeat a case per theme, text direction, viewport or channel. Use one table, and only when the behavior differs.
- When you delete or move coverage, name the test that still proves the contract. When you move a contract, mutate its owner once and confirm the new test fails.
- A contract proven by a `packages/session-ui/component-tests` test does not also get an app e2e copy.

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
