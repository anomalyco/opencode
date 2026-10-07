# GUI extensions

Built-in features of the desktop and web app, each behind the SDK in `src/sdk/`. The window host lives in `packages/app/src/runtime/extension/`, the main-process host in `packages/desktop/src/main/extension/`. [README.md](README.md) is the author guide: it explains every rule below, with diagrams and source-checked code from the shipping extensions, and walks through `src/pairing/`. These are the rules.

## Structure

- One folder per extension: `index.ts` (`Extension.define({ id, legacy?, os?, provides?, uses?, requires?, stores?, i18n })`), `contract.ts`, `renderer.tsx`, an optional `main.ts`, and `i18n/<locale>.ts`.
- `src/renderer.ts` and `src/main.ts` are the only files that list the built-ins, each through `Extension.compose`. Main never imports window code. `src/builtins.typecheck.ts` fails the typecheck when a window `uses` or `requires` an Ipc that no main entry provides.
- Every extension here ships. Do not add an extension, fixture or wrapper only to document or demonstrate the SDK; the guide shows shipping code.
- Another extension may import only your `contract.ts` (tokens and schemas, no runtime code). Declare what other extensions provide in `uses` (or `requires`). Your own tokens, your Ipc included, go in `provides` only: the window reads each as `ctx.uses.<key>` too, and a key that names one token in `provides` and another in `uses` fails to compile. To declare an Ipc without loading its schemas at startup, use `Ipc.ref<typeof Token>("id")` and `ctx.uses.name.load(Token)` from the chunk that loads them; never put a reference in `requires`.
- Use `requires` only where the extension is meaningless without the contract. Graceful degradation is `uses`. `Extension.compose` rejects duplicate extension ids, and duplicate or missing providers.
- A contract that returns components binds each with `bindExtension` in the provider's setup, so `useExtension` inside reads the provider's context, not the consumer's. Do not wrap data methods such as `Changes.diffs`.
- SDK icon fields take an `IconName` from `@opencode/ui/icons/catalog`, the dependency-free icon catalog.
- The APIs the host always provides are context properties (`ctx.layout`, `ctx.sessions`, `ctx.storage`, `ctx.desktop`, …; in main `ctx.storage`, `ctx.windows`, `ctx.serverEndpoints`, …). `useExtension<typeof definition>()` returns the same context in components. Registries and contracts stay tokens: `ctx.add(Registry, item)`, `ctx.provide(Contract, impl)`; main provides Ipcs with `ctx.provide(Ipc, impl)`.
- Never import `@opencode/app`, `@opencode/desktop`, or `@/` paths. Import CSS with `?inline` and contribute it through `ctx.add(Style, css)`. No module-level state: keep state inside `setup`. `bun run lint` enforces these rules.
- `bun run lint:changed` must pass before you finish: every file you add or edit has no oxlint problem at all, including the warn-level anti-slop rules (`unknown` parameters and returns, unchecked type assertions, widened types, unsafe dictionaries, missing spacing). Touching a file means leaving the whole file clean, older warnings included. Fix the code; suppress only with a `SAFETY:` comment that states a real checked invariant.

## SDK docs

- Every exported declaration in `src/sdk/`, every interface member, every field of an object type (options, results, union members) and every parameter has TSDoc. Say what it is, when to use it, its default, and what happens on failure. Document each value of a union. Primitives, token kinds, registries and context properties carry an `@example`.
- `bun run lint` runs `script/sdk-docs.ts`, which fails on a missing doc comment or `@param`, a `@param` that names no parameter, a `ctx.<member>` in the guide or this file that no context declares, and a guide code block marked `<!-- source: path -->` (a whole file) or `<!-- source: path#name -->` (the declaration, object property or call named `name`, with the comments directly above it) that differs from that shipping source.
- When you change the SDK, change its TSDoc and the guide in the same change. When the check names a guide block your change made stale, copy the new source into the guide; do not reword the source to fit the guide.

## Host boundary

- Host code must not name an extension or know its internals: no extension ids, command ids, DOM selectors, or stored key formats. When the host needs something from extensions, add a generic, documented field to the SDK (for example `PanelTab.file`, `Command.featured`, `Command.section`).
- An extension owns its settings: declare a store and render the toggle from your `SettingsPage`, as a page, a section on a host page (`page`), or rows in a host section (`section`). The host exposes no preferences of its own.
- Accepted exceptions: the built-in lists, the keybind rename map in `packages/app/src/settings/keybinds/migration.ts`, the legacy `type: "browser"` comment decode in `packages/app/src/composer/schema.ts` (drafts and message metadata written before extension notes), and the crash page's use of the updater contract.

## Lifetimes

An instance lives from `setup` until it is disabled, reloaded, removed, or its window closes. A reload can land at any `await`, so code that outlives a tick must prove it still belongs to the live instance.

- Everything registered through `ctx` (contributions, contracts, Ipc listeners, dialogs, embeds) is withdrawn with the current owner (a component, a `createKeyed` run), else with the instance. `ctx.dialogs.open` returns a handle whose `close()` closes that dialog alone. Anything else you start (timers, DOM listeners, subscriptions) needs teardown: in the window, Solid's `onCleanup` (setup runs under the extension's root owner); in main, `ctx.scope.addFinalizer`, which runs at once when the instance is already gone. `setup` returns nothing.
- Window `setup` is synchronous: an async one fails to compile, and the host fails it at runtime. Put async work in `createKeyed` or `createLatest`, with `ctx.signal` or a signal derived from it. Only main `setup` may be async. After every `await`, return if the signal aborted (`ctx.signal` in window work, `ctx.scope.signal` in main) before touching state or contributing; there is no owner after an `await`, so window teardown that starts later listens to `ctx.signal`. Pass the signal to Ipc calls and long work. Methods without an input schema take options only, e.g. `pairing.screenActive({ signal })`.
- Never keep a value from a shorter lifetime in a longer one. Read a server's `client`, `data` and `url` from its live `ServerRef` each time: a restarted or re-authenticated server gets a new controller under the same id. Keep per-session state in a session-scoped store, or in a map keyed by `session.key` that you prune.
- Each routed session gets its own frozen `MountedSession`, and a new one when it moves to another directory (same `key` and `visit`, new `directory`). A render receives the next one through `props.session` (panels), `input.session` (slots) or `state.session` (tab labels) without remounting. Read those getters where you use them; never copy the object into a variable or key a cache by it, which would rebuild on every switch. A `MountedSession` has no actions that follow the route: the workspace files, comments and composer belong to the session screen, one object while it routes A, B and A again. Panel callbacks take one named input with a non-null, constant `screen`; every `session.*` slot gets it too, but `window.bottom` does not. Render `tab` and `session` fields are live getters; lifecycle callbacks keep their event's tab and call metadata. Key per-screen caches by the screen. Commands and link handlers read `ctx.screen.current()` where they act, never once in setup. It is defined exactly when `ctx.sessions.current()` is: from just after the screen's first render until the route leaves it, so never on Home or a draft. Renders and render effects use their inputs, not these accessors; pass the owning screen on, as `Changes.watch(screen, source)` takes it.
- Main: `ctx.lifecycle.restart(handoff, { keep: ctx.scope })` keeps the extension that owns `ctx.scope` (the caller by default) active until the handoff settles; when it rejects, return to a state the user can retry from.

## Failure is part of the contract

- A `uses` dependency is a `Live` accessor: `pending` while the provider loads, `inactive` while it is disabled, failed, blocked by a hard dependency, or restarting. A hard dependency whose provider is disabled or failed leaves its consumer `blocked` (also the `Live` reason down the chain), and re-enabling the provider resumes it. Every Ipc is `inactive` on the web. Every user action branches on it and still answers: offer the action only while it can answer (register it in a `createKeyed` run), or show an unavailable state (as WSL's "WSL unavailable" does). Never a silent `return` or an endless spinner.
- An Ipc that goes away is a suspension, not a failure: keep what the user had (for example the browser's tab inventory) and resume when it returns, without a retry timer.
- An Ipc call can reject while the event that explains it is still in flight; events and call replies travel on different channels. When main reports an outcome as an event, let the event decide, and treat a rejection as final only for errors main throws before any event (validation, missing endpoint).
- The host orders Ipc state for you: an event always wins over an older snapshot. Do not re-fetch state to fix ordering.

## Stored state

- Desktop storage loads over IPC; web storage is synchronous, so a read before load passes every web e2e test and still breaks desktop. Declare stores (`Store.global`, `Store.session`): a global store is loaded before setup, a session store's `value` is undefined until it loads, and `update` waits for the load. `Storage.store`, for keys only known at runtime, returns the same `Persisted`; derive nothing from it, such as a request, before `value` is defined.
- Declare main-process state known up front with `Store.main`; the main entry reads it as `ctx.stores.name` (`MainSetup<typeof definition>`), always loaded. Each process's `ctx.stores` holds only its own stores. Main's `ctx.storage.store` is for keys only known at runtime.
- Stored keys live in your extension id's namespace (`extension.<id>.<key>`). Move values through `from` (and `from.sessions` for one session's slice of an app key), with older homes newest first. A `pick` returns undefined when the old key holds none of its fields, never an object of undefined fields. Main's older homes are `{ settings: key, file? }` or `{ state: [namespace, key] }`. Keep old fields readable until every user has migrated; never drop user data.
- When you rename an extension, list earlier ids newest first in `Definition.legacy` for enable state, migrate command ids in the keybind rename map, and map panel keys in `Panel.legacy`.
- `update` mutates a deep-mutable draft and returns nothing or `undefined`; a returned replacement fails to compile and throws at runtime in both processes. `set` replaces the value. Plain readonly `Schema.Struct` fields work without `mutableKey`. Window `update` and `set` wait for load and apply in call order with each other, including runtime-key stores; main writes reach disk at once. Do not batch main writes yourself.
- `Storage.remove(key, { from })` takes the store's `from`, so the older key is never imported again and the key reads as `initial`.

## Panels and layout

- `Panel.focus(input)`: `input.restored` is true only for the selection the side region mounts with (for example after a reload). Run side effects that express user intent, such as switching the file tree's tab, only when it is false. All panel callbacks take one named input; read its getters and do not destructure.
- The host selects the first tab with `fallback: true` in regular, `first`, then pinned tier order while the stored selection is missing or cannot be selected. False or omission opts out. If you will restore a tab, keep listing its stored id, with `hidden: true` while its content is not known yet, so the fallback never runs.
- Map keys stored before extensions, or under your extension's earlier id, with `Panel.legacy`. A `transient` panel's stored keys are dropped once it stops listing them.
- A `PanelTab.transient` tab is a launcher (e.g. "Open file"): the next preview replaces it, and narrow screens neither store nor select it. `closable` only styles the close button; set both when you want both.
- `Layout.stored(session)` returns your stored tab ids. Layout reads return nothing while `session.location` is undefined (for example after a server re-authenticates); writes made meanwhile wait and apply in order once it is known.
- No host API throws before the app interface mounts, as during setup: reads return their documented defaults (`Layout.ready()` is false, `state` is "closed"), and writes, a server or session store's included, wait and apply in call order once it mounts. A dialog opened meanwhile waits too and shows after the interface's first render; its handle closes it before then.
- `Layout.sidebar.opened()` is the inner sidebar preference side panels share, readable outside a panel render (for example in a tab's fields); do not mirror `usePanel().sidebar` into a store.
- Narrow screens: a plain open switches to the panel's mobile view and closes the dock. Pass `background` when the user stays where they are (a palette pick, a composer chip) or the agent opened the tab, and `tab: "select"` to append and select without replacing the preview.

## Solid

Read [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) and [Solid.js Best Practices](https://www.brenelz.com/posts/solid-js-best-practices/) before writing reactive code here. In short:

- `bun run lint` bans importing `createEffect`, `createRenderEffect` and `createComputed` outside `src/sdk/`. Run side work per provider generation or value with `createKeyed(source, fn, { otherwise })`, fetch with `createLatest`, and keep per-visit state with `createVisitState`.
- Derive, don't sync. A value computed from other state is a `createMemo` or a plain function, never an effect that calls a setter. Never mirror state into a second store, signal, or `Map` through an effect.
- An effect (`createKeyed`) synchronizes with something outside Solid: the DOM, a third-party widget, an embed, an Ipc subscription, a chunk preload. Comment what it syncs with when that isn't obvious. A source that builds an object is a new key on every read; pass `equals` to compare the fields that should run it again.
- Logic caused by a user action belongs in that action's handler, not in an effect that watches the state the action changed. If several handlers share it, call one function from each.
- Reset state on an identity change by keying the subtree (`<Show keyed>`) or by storing an id and deriving the selection from it. To forget a selection when the user navigates away and back, use `createVisitState`. Never reset state in an effect.
- No effect chains, and no effect that notifies a parent: update everything in the same handler or `batch`.
- Don't destructure props; read `props.x` so the getter stays reactive (`splitProps` when you must). Call signals when passing them as JSX props. Use `<Show>` and `<For>`, not `&&` and `.map`, in JSX.
- Use `createStore` for objects and collections, `createSignal` for single values.
- Async data goes through `createLatest`, a resource, or a guarded promise that ignores stale results, under the Suspense rules below, never an effect that fetches and then sets.

## Performance

- `renderer.tsx` loads with the app: `src/renderer.ts` imports every built-in entry eagerly, because the window renders once all of them are active. Keep it small and put heavy UI behind `lazy()`. Preload a chunk with `onIdle(() => void Chunk.preload())` from setup, so it compiles while the app idles (e.g. on Home) instead of when a session first opens. Never import a heavy chunk on the startup path.
- A `<Suspense>` boundary decides what blanks when something beneath it suspends; it does not stop the suspension. Suspend at most once, on first load, and never after first paint:
  - Read async data through `.latest`, `createLatest`, a store with an explicit `loading` flag, or a resource that resolves once (`packages/app/src/runtime/server/runtime.tsx`, `packages/app/src/providers/connect/controller.ts`). Never read a refetching `resource()` in render: a refetch blanks the nearest boundary, and without one of yours that is the whole session route, which detaches the screen and resets the timeline scroll.
  - Wrap each `lazy()` component in its own `<Suspense>`, so a chunk that is still loading blanks only your area. Preload it with `onIdle`. If the area can be visible at startup (for example a dock restored open), start the preload in `setup` from the stored state instead, so the first render never enters Suspense and nothing pops in.
  - Give a fallback the area's size when the area has fixed geometry, so nothing shifts; leave it empty otherwise.
  - Make a state change that may suspend inside `startTransition`, so the current content stays until the next is ready.
- Return stable objects from `Panel.list` and reactive contributions, so the host never remounts a trigger or a panel.
- Never add work to timeline rows. The session header slot is the only timeline surface.

## Localization

- Each extension owns its copy in `i18n/en.ts` with short keys. `ctx.t` falls back to the app's keys only for shared vocabulary such as `common.*`; feature copy belongs to the extension. Count-sensitive copy goes through `ctx.plural`.
- When moving copy, keep the English byte-for-byte and carry every locale's translation. The localization rules in `packages/app/AGENTS.md` apply.

## Tests

- Follow the Tests section of `packages/app/AGENTS.md`.
- Unit-test pure logic that carries a contract: path and security checks, storage migration, protocol parsing, archive validation.
- UI behavior is proven by the app e2e keeper suites in `packages/app/e2e/regression/`. Do not add unit tests that repeat them.
- Test a main-process entry through its `Ipc` contract with real inputs, not through Electron mocks.
- The hosts own their contracts, so an extension does not test them again: main storage in `packages/desktop/src/main/extension/storage.test.ts`, the real window host in `packages/app/component-tests/extension-host.spec.ts`, and the built-in graph in `packages/app/component-tests/extension-graph.spec.ts`.
- For lifetime and ordering contracts, drive the race the user hits: a reload during async setup, a rejection that beats its event, a store that loads late (the e2e fixtures can hold desktop storage reads), an Ipc that goes away and returns.
- The real window host runs only in the component tests (`packages/app/component-tests/extension-*.spec.ts`, with `extension-host.fixture.tsx`); they include the graph matrix, which boots every built-in with each optional provider disabled. Run them with `PLAYWRIGHT_STORYBOOK_PORT=3294 bunx playwright test --config playwright.components.config.ts extension-` from `packages/app`.
