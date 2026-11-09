# P.1: the plugin API

The in-process Rust plugin API (plan 6.10). Built-in feature plugins (E.14, E.18b, E.15a, E.19a) and the
LaTeX and Mermaid plugins (P.2, P.3) register through it, compiled in. External plugins load as native
shared libraries (P.4, decision O-42, `docs/P.4.md`) from `crates/plugin/src/loader`.

The API covers what the TS built-ins use (`packages/tui/src/feature-plugins`, `packages/latex`,
`packages/merman`), nothing more. A count of `context.*` uses in those plugins: slots (14), keymap layers
(16), routes (`ui.router`, 22), the theme (50), the store (`data.*`, about 40), dialogs and toasts (24),
storage (4), code-block renderers (3). Dialogs, toasts, the store, and the client are already on the TUI's
shared context, so a built-in reaches them through the host it is given rather than through a second copy
of each API.

## Shape

Since O-67 (`api-no-tui`) there is one plugin API, `opencode-plugin-abi`, for built-ins and external plugins
alike: a plugin is an `abi::Plugin { id, setup }` and registers slots, routes, commands, fences and handlers on
`abi::Setup`. It reads through `abi::Read` and acts through `abi::Host`, never through the TUI or a widget.
LaTeX, Mermaid, the ten feature built-ins and the three ports under `crates/plugin/examples` all use it, and
none of them depends on OpenTUI. `crates/plugin-abi/tests/sdk.rs` checks that for an author's fixture and the
ports.

`opencode-plugin` is the host side: `Registry`, slot resolution, the loader, and the renderer that turns a
`Node` into widgets. Its `Host` trait is what the adapters of both paths call; the TUI implements it once
(`crates/tui/src/plugins/host.rs`). It is not plugin API.

`Registry::new` takes `Builtin`s: `Builtin::Plugin(abi::Plugin)`, or `Builtin::Host { id, activate, dispose }`
for the two parts of the TUI that the plugin manager lists and toggles but that are not plugins: the plugin
manager itself (`opencode.plugins`) and the diff viewer (`opencode.diffs`). They reach the TUI through a
`OnceCell<Weak<Tui>>` that `install` sets once `Rc<Tui>` exists.

A mounted slot (`SlotMount`) or plugin route (`RouteMount`) syncs with `abi::Changed`, which the TUI builds
from each store change batch (`host::changed`), or with `None` for a batch that changed nothing.

## Slots

`SlotPath` lists the `SlotMap` paths (`packages/plugin/src/tui/context.ts:191-202`): `app`,
`home.footer`, `home.footer.status`, `prompt.footer`, `prompt.footer.status`, `prompt.footer.file`,
`session.composer.top`, `session.panel`, `sidebar.content`, `sidebar.footer`. `SlotInput` carries the
inputs those paths publish (session ID, prompt footer mode and details, panel state).

`slot::resolve` is a port of `packages/tui/src/plugin/structure.ts`: replacement takeover, last-enabled
wins at one target, an ancestor replacement beats a descendant one, claims inside a replaced boundary are
suppressed, and a claim aimed at an unknown path appends to its nearest known ancestor. The unit tests
port `structure.test.ts`.

A host mounts a slot with `Registry::mount(host, parent, path, input, content)`. TS's `<Slot>` is a
fragment, so the claims go straight into `parent` in the order before, prepend, the host's own content
(skipped when a claim replaces it), append, after. The returned `SlotMount` syncs every claim.

Deviation in mechanism, not in output: TS resolves against the paths currently mounted; Rust resolves
against the fixed `SlotMap` list. The two differ only while a parent slot has mounted and its child has
not, which never shows in a frame.

## Registry and configuration

`Registry` holds the plugins in enable order: the built-ins first, then any added later (a test
plugin). `activate` runs `setup` for every enabled plugin; `set_active(id, bool)` toggles one (the plugin
manager, E.18b). Code-block renderers are rebuilt per theme with `code_blocks(&Theme)`.

The `cli.json` `plugins` entries apply as in TS (`plugin/context.tsx:313-330`, `matches` at `:648`):

- `-<selector>` disables matching built-ins; `<selector>`, `*`, and `<prefix>.*` re-enable them; an entry
  starting `opencode.` never names an external plugin.
- Every other entry names a TypeScript TUI plugin. It is not loaded; `entries()` lists it with status
  `Skipped` and the message "TypeScript TUI plugins do not run in opencode-rs yet", and the TUI logs it
  once (deviation of F16 until P.4).

`entries()` returns each plugin's ID, source (built-in or configured), and status (active, inactive,
skipped), for the plugin manager.

## The TUI side

`crates/tui/src/plugins/host.rs`:

- `impl Host for Tui`;
- `builtins()`: the built-ins in TS order (`plugin/builtins.ts`), with the two host entries in their places;
- `registry(info, external)` builds the registry from them and the config; `install(&Rc<Tui>)` sets the host
  entries' `OnceCell`, logs skipped entries, and activates; `add(&Rc<Tui>, Definition)` adds and activates one
  more and remounts the route;
- `slot(tui, parent, path, input, content)`, `route(tui, id, name)`, and `code_blocks(tui)` for the TUI
  call sites.

Call sites wired in this step (minimal edits in other steps' files): the `Tui` field and install call
(`app.rs`), the `home.footer` slot (`routes/home.rs`), the plugin route's sync (`routes/plugin.rs`), and
the transcript's code-block renderers (`routes/session/messages/list.rs`). The other slots
(`prompt.footer*`, `sidebar.*`, `session.composer.top`, `session.panel`, `app`) are mounted by the steps
that own those views, with the same one call.

## Proof

- Unit tests in `crates/plugin`: slot resolution (ported from `structure.test.ts`), selector matching,
  config directives and skipped entries, activation and deactivation (layers disposed, claims and code
  blocks removed), mount order.
- P-APP `P.1/slot`: a test plugin appends a line to `home.footer`. The TS side loads it as a local plugin
  directory (`parity/plugins/slot/tui.tsx`, configured in `plugins`); the Rust side registers its Rust twin
  when the recording's `OPENCODE_PARITY_PLUGIN` is `slot`, and lists the configured TS entry as skipped.
