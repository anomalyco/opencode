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

- Give `13px` Inter text at least `--line-height-compact` (`16px`); use `--line-height-base` (`20px`) for body text. A solid `13px` line box clips descenders inside truncation and overflow containers.
- Do not use `line-height: 1` or `leading-none` on text, and do not compensate with transforms, negative margins, or clip-padding hacks.
- `TextShimmer` inherits font metrics; put typography overrides on its parent.
- Load the `opencode-ui-typography` skill (`packages/ui/skills/opencode-ui-typography/SKILL.md`) for the type scale, weights, tracking, numeric figures, and truncation rules.

## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for visible copy, placeholders, accessible labels, tooltips, menus, dialogs, toasts, empty states, and displayed errors.
- Feature work adds English source strings only; leave non-English keys absent. Preserve existing English text and keys byte-for-byte unless the task explicitly requests a copy change, and never change English to make translation easier.
- Render count-sensitive copy through `language.plural(baseKey, count, params)`. Never pass plural-category keys (`.one`, `.other`, …) to `language.t(...)`. Use `language.tDynamic(...)` for runtime-generated English copy; never branch on the active locale, call `Intl.PluralRules`, or concatenate translated sentence fragments. If the API cannot express a case, deepen the shared language module instead.
- Use logical CSS properties and isolate mixed-direction text; layouts must work in RTL.
- Do not translate from model knowledge alone; follow the translation process in the skill.
- Load the `opencode-ui-i18n-rtl` skill (`packages/ui/skills/opencode-ui-i18n-rtl/SKILL.md`) for the full rules, API examples, RTL guidance, and the translation process.

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
