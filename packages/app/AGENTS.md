## Priorities

- Prioritise, in this order: stability, simplicity, performance.
- Before changing session or timeline code, benchmark it against `origin/dev` with strobe (`packages/app/perf/README.md`): `strobe bench packages/app/perf/<area>.bench.ts --base origin/dev --head .`.

## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from the repository root): `bun dev serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## Insecure Origins (HTTP LAN)

The Web UI is served over plain HTTP on non-localhost LAN and Tailscale origins (`isSecureContext === false`). This rule applies across `app`, `ui`, `session-ui` and `gui-plugins` window code.

- Never call `crypto.randomUUID()` directly in renderer or browser code; it is `[SecureContext]`-only and throws `TypeError: crypto.randomUUID is not a function` on plain HTTP origins. Always use `uuid()` from `@opencode/util/uuid`.
- Guard any other `[SecureContext]`-only Web API (`crypto.subtle`, `navigator.clipboard`, `navigator.serviceWorker`) with a non-secure fallback.

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## State Machines

This section is the single source for lifecycle state across `app`, `ui`, `session-ui`, `gui-plugins` and `desktop`. Anything that moves through phases (loading, submitting, connecting, retrying, dragging, revealing, quitting) is an explicit state machine. Precedents: `src/composer/machine.ts`, `src/session/requests/auto-approve-machine.ts`, `packages/desktop/src/main/deep-links/machine.ts`, `packages/gui-plugins/src/terminal/machine.ts`, `packages/ui/src/hooks/list-machine.ts`.

- Model the lifecycle as one discriminated union (`type` or `status` tag) in its own module next to the feature (`machine.ts`, or `<feature>-machine.ts` when the folder already has one). It is the single source of truth: no booleans, nullable "in-flight" fields, `WeakSet`s, generation counters or closure variables beside it that also encode the phase. Data that exists only in a phase lives inside that phase's variant.
- Write one pure `transition(state, event)` over a closed event union that returns the next state, or `{ state, effects }`. No I/O, timers, signals, `await` or `Date.now()` inside it. An event that does not apply to the current state returns the same state object, so it is visible in the code and writes no signal.
- Keep only phases the user can observe. Merge phases nothing distinguishes, and model a variation as a field, not a new variant (for example a `gesture` field instead of one variant per input device). Fewer, real variants beat a faithful copy of every step.
- Derive the UI with pure selectors or a `view(state)`: disabled, busy, spinner, error text, which panel or tab shows. Components read selectors; they never branch on side flags or re-check the phase themselves. In the main process, every consumer (quit handlers, menus, IPC) branches only on selectors of the machine.
- Run async work in a thin driver at the edge. The driver turns effects into calls, dispatches the results back as events, and owns timers and abort controllers. Tie its cleanup to the owner's lifetime (`onCleanup`, `ctx.onCleanup`), and dispatch a `disposed` event rather than keeping a disposed flag.
- Reject stale results inside the machine. Carry an attempt id in the state variant and in each result event, and ignore a result whose id is not current. A machine that only moves forward can match on the phase instead; each timeout event names its phase.
- Claim work synchronously. Leave `idle` in the same event that starts the work, before the first `await` (image resolution, a request, a dynamic import). A guard checked before an `await` and set after it lets a second Enter, click or retry through.
- Every async path ends in a state. A failure, timeout or cancel is a transition, never a log line or a silent `return`. Give a request that can hang a bounded fallback (a reveal timeout, a phase timeout) so the UI cannot stay hidden, disabled or "Loading" forever.
- A result that arrives late can still have side effects. When the user went back but the server already saved the change (a key, a credential), keep the state and emit only the refresh effect. When a timeout cuts a batch short, report the real outcome of the parts that finished and time out only the rest.
- Serialize operations that touch the same data through one queue in the machine (`active` plus `pending`), including actions that look independent (steer, remove, reorder, undo). A side path that skips the queue can resurrect what another operation removed.
- On an identity change (another session, server, window or credential), move to a new target with a new attempt instead of carrying the previous target's error, controller or result forward.
- On hot paths (scroll, pointer, resize, streaming), keep the machine allocation-free: return the same object when nothing changes, reuse event objects, and keep frozen singleton states. Benchmark with strobe as the Priorities section requires.
- Test the pure transition. Replay the bug's event sequence as a regression that fails on the old logic, then cover stale attempts and every exit (success, failure, timeout, cancel, dispose). Build events the way production builds them (through the real decoder, without fields the wire never carries), or the test passes on routes production never takes. These tests need no DOM, timers or mocks.
- Name new driver inputs so they cannot collide with existing ones (`appState`, not a second `state`), and wire Solid reads of machine state into `<Match>` and `<Show>` with keyed matches or memos so a branch never reads a value another branch already narrowed.

## Suspense

A flash, a blanked area, a dialog that resizes or a reset scroll on first open almost always means a read entered Suspense. Do not ship UI that reads async data without the guard below.

- Reading `resource()` suspends while it loads. So does `resource.latest` until the resource has resolved once: before the first value, `latest` behaves like a plain read. `resource.loading` and `resource.state` never suspend.
- Guard every render-time read on state, and show the data you already have until then:

  ```ts
  const loaded = () => resource.state === "ready" || resource.state === "refreshing"
  const items = () => (loaded() ? resource.latest : cached) ?? []
  ```

  Precedent: `src/new-session/workspace/controller.ts` (`worktreesLoaded`).

- When the source can change (a drilled project, a selected session), include its key in the fetched value and use the result only when the key matches. Otherwise `latest` shows the previous key's data while the next loads.
- A `<Suspense>` boundary only chooses what blanks; it does not prevent the suspension. Without a local boundary, the nearest one is often a whole dialog or route.
- Suspend only on purpose, on first load, with a comment that says why.

## Typography

- Use `--line-height-compact` (`16px`) for `13px` compact UI text and `--line-height-base` (`20px`) for body text.
- Do not use `leading-none`, `line-height: 1`, or a `13px` line height for normal text. Inter descenders clip inside truncation and overflow containers.
- Keep control and row heights explicit. Fix font metrics directly rather than using transforms, negative margins, or clip-padding compensation.

## Fonts

Users choose three fonts in Settings > Appearance. Every surface uses one of these roles. This section is the single source for font rules across `app`, `ui`, `session-ui`, `gui-plugins` and `desktop`.

| Role          | Use for                                                            | Use                                                                                                   |
| ------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| UI font       | Prose, labels, titles, controls                                    | Inherit, or `var(--font-family-sans)`, `var(--v2-font-family-sans)`, `font-sans`                      |
| Code font     | Shell commands, code, paths shown as code, diffs, logs, tool input | `var(--font-family-mono)`, `var(--v2-font-family-code)`, `font-mono`, or a `<code>` / `<pre>` element |
| Terminal font | Terminal output only                                               | `appearance.font("mono")` from the GUI plugin SDK                                                     |

- Never write a literal family (`Inter`, `"IBM Plex Mono"`, `monospace`, `Menlo`, `system-ui`) in production CSS, classes, inline styles, canvas `font` strings or widget options. A literal ignores the user's setting.
- Never add an `@font-face`, font file, or font package outside `packages/app/src/index.css`. That file is the only place the app ships faces: Inter (variable), IBM Plex Mono Text (weights below 600), Bold (600 and up) and Text Italic, and JetBrainsMono Nerd Font Mono Regular and Bold. If a design needs a face that is not shipped, add it there and say why in the PR.
- Show shell commands with the timeline shell metrics: code font, `13px`, weight `440`, `-0.04px` letter spacing. Do not invent another size for the same content.
- Prefer weight tokens (`font-medium`, `var(--font-weight-medium)`) over literal weights. Mono at `600` or more renders IBM Plex Mono Bold, so reserve it for real emphasis.
- Do not read font settings directly. `src/settings/model.tsx` writes them to the CSS variables above, and the plugin host passes the terminal font through `appearance.font`.

## Loading Indicators

This section is the single source for loading indicators across `app`, `ui`, `session-ui`, `gui-plugins` and `desktop`.

- The dot-matrix `Spinner` (`@opencode/ui/spinner`, and `SessionProgressIndicatorV2` and `ActivityRing`, which render it) means the AI is working: a running session, turn, subagent or tool call. Use it only for those states.
- Every other loading state uses `Loader` (`@opencode/ui/loader`): page, pane and file loads, browser reload, search, connecting, authenticating, sending, installing. Use a purpose-built indicator only when the state has one, such as the titlebar update ring.
- Choose the indicator at each call site. Never restyle a shared indicator (`Loader`, `ActivityRing`, `Spinner`) to look like another one; that silently changes every caller.

## Scrolling

This section is the single source for scroll containers across `app`, `ui`, `session-ui`, `gui-plugins` and `desktop`.

- Pages, panels and documents scroll with a plain element: `overflow-y-auto` (or `overflow-x-auto`, `overflow-auto`) plus `min-h-0` or a max height. `packages/ui/src/styles/scrollbar.css` gives every native scrollbar the shared thumb. Do not add `ScrollView` to fix how a scrollbar looks.
- Menus, popovers, dropdowns and the result lists in pickers and dialogs scroll with `MenuScroll` (`@opencode/ui/menu-scroll`). A native scrollbar there takes 8px, more than the rows' 4-6px inset, so the end inset grows whenever the list overflows. `MenuScroll` hides the native scrollbar on pointer devices and draws the shared thumb over the rows; touch devices and high-contrast modes keep the native one.
  - Put the list's padding on the viewport (`viewportClass`), not on the menu surface, so rows scroll to the edge under the thumb.
  - Use `viewportRef` for scroll-into-view and keyboard reveal. Style a grid of rows through `[data-slot="menu-scroll-content"]`, the element that holds them.
- Mark each scroll container with `data-scrollable`. Nested-scroll handling (the timeline, Home, `createAutoScroll`) uses it to let the inner container scroll first. `MenuScroll` marks its viewport itself.
- Use one element when it both sizes and scrolls. Add an outer wrapper only for something that must stay put while the content scrolls, such as `::before` and `::after` edge fades: the wrapper is `relative flex flex-col min-h-0` and owns the fades, and the inner element is `min-h-0 flex-1 overflow-y-auto`.
- A native scrollbar takes 8px from layout while the content overflows. Where text would visibly rewrap at that moment (the composer, text fields), add `scrollbar-gutter: stable` and subtract `var(--scrollbar-size, 0px)` from the end padding. Do not do this in a menu or list; use `MenuScroll`.
- A ref runs before the element's children render and before it is in the document. Restore a scroll position from `onMount` or a frame later, not in the ref.
- `ScrollView` (`@opencode/ui/scroll-view`) is only for the session timeline and Home, which draw the thumb in an external track (`thumbContainer`) and, in the timeline, correct it for virtualized rows. Use it again only for one of those needs, and not for menus.
- Never set `scrollbar-width: thin`, `scrollbar-width: auto` or `scrollbar-color`. Chromium then ignores the shared style and draws the native Windows scrollbar. Hide a scrollbar only with `no-scrollbar` or `scrollbar-width: none`.

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
