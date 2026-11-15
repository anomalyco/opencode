# F16: a V2 TUI plugin on the JS host, through the compatibility layer (P8)

**TypeScript.** A `{ id, setup }` module's setup gets the V2 context (`packages/tui/src/plugin/api.tsx`), and its JSX
renders through `@opentui/solid` into the TUI's own renderables, in the TUI's process. Its reads are the TUI's store,
synchronous. A module under `node_modules` (an installed package) compiles with Bun's JSX transform, whose props are
read once as the component is created; a local module compiles with Solid's compiler, whose props follow their signals
(`@opentui/solid/scripts/solid-plugin.js`).

**Rust.** The JS host gives the module the same context and the modules TS gives it (`@opencode/plugin/tui`, Solid,
`@opentui/solid`, `@opentui/core`), from the compatibility layer (`crates/plugin/src/pipe/compat`). Its JSX renders with
Solid's universal renderer into plain nodes, which each view reads into a contract 2.0 tree for the host to draw. The
four published packages P8 runs draw cell for cell as TS draws them at the checkpoints of `parity/scenarios/P.8`
(settled pictures, not every state or the first frame after each event). The JS host is off unless
`OPENCODE_PLUGIN_JS=1`. What differs:

- **Every module compiles as an installed one**, with Bun's JSX transform: a local TSX plugin that relies on Solid's
  compiler for props that follow signals renders them once, as the same plugin installed from npm does in TS. A
  function child, a `ref` and a memo follow their signals as in TS.
- **Reads are snapshots** the host pushes. A render that read one the host has not pushed yet renders again once it
  came, at most three times; after that a read that is late shows in a render only if the plugin's JSX follows it. A
  setup gets the route, `info` and the route's session at once, and a call the route while the plugin does not watch
  it; other first reads in a handler (tabs, the model, a panel's state) answer before their snapshot came. A plugin
  watches at most 128 reads; one no live mount or store holds goes when a new one needs its place, and one the host could not
  answer rejects its `sync` and is reported once. `data.session.sync` and `message.sync` answer what the host has
  loaded; they do not load a session the host has not.
- **An async setup that waits on the host** (a `client` call, a `sync`) hands the plugin to the host at its first such
  wait, with what it registered so far; what it registers after is taken as a reload of its registrations, and a throw
  after fails the plugin, where TS keeps the plugin inactive until setup resolves.
- **A command a component registers** (`keymap.layer` in a render) runs nothing once the component ended, but the
  host lists it 250 ms longer, unless a new mount registered it again. A registration after setup (such a layer, a
  store made late, the scroll keys a dialog with a `<scrollbox>` registers) reloads the plugin's registrations: its
  open dialog stays and acts, as in TS (`P.8/sidebar-prompt` `kept`), but its session panel closes and the route on
  screen mounts again. A disposed `ui.slot` or `ui.router.register` draws nothing but stays registered until the
  next reload, so a disposed `replace` still holds its slot. A layer's `enabled`, its `mode` (base unless `global`) and
  a command's `enabled` are kept; its `priority`, `bindings`, `target` and slash `aliases` are not mapped.
- **Dialogs**: `select`, `confirm`, `prompt` and `alert` are the host's, each settled once as TS's are (an answer;
  `undefined` on escape, the backdrop, another plugin's dialog, `clear()` or the plugin's end). A select's `search`
  lists its rows for each query as TS's does (flat, in its order, the category as the footer), but the rows change
  once the JS host answered the query, not in the keystroke's own frame (`P.8/select-search`). A select's `actions` and
  a prompt's `value` and `description` are reported, not mapped. `ui.dialog.show` shows the plugin's JSX
  in the host's panel dialog, bare (only the dialog's frame, as TS's), in the size and place `ui.dialog.set` gives, and
  a render that throws closes it. A panel's body is a node of ABI 1.x: a `<scrollbox>` in it is a box that does not
  scroll (the scroll keys say so, once), an `<input>` in it is its text, and its colors take the dialog's surface.
- **Pointer**: `onMouseDown`, `onMouseUp` and `onClick` on a box or a text run as a click of the node, with an event
  that has its kind and the left button but no position; a node with both a press and a release handler keeps the
  press (reported). `onMouseOver`, `onMouseOut`, `onMouseScroll` and `onMouseDrag` are not mapped.
- **Absolute nodes**: a render of absolute nodes alone takes its mount's box out of the flow to fill the slot's parent,
  as TS's `<Slot>` is a fragment; OpenTUI's Rust layout has no way back, so the box stays absolute if a later render
  of the claim is in the flow.
- **Not mapped**, each reported once a plugin with a warning toast (`<id>: <feature> is not supported by
  opencode-native yet`) and doing nothing (a list answers empty): `markdown.registerCodeBlockRenderer`, `data.listen`, `data.project`,
  `data.shell`, `data.session.permission`, `data.session.form`, the
  location's `agent`, `command`, `mcp.resource`, `reference` and `skill` lists, `renderer` members other than
  `requestRender`, `width` and `height` (a method of OpenTUI's `CliRenderer` does nothing, an emitter's returns the
  renderer and an async one a resolved promise, so `P.8/quick-switch` draws as TS with the toast beside), `useKeyboard`, `usePaste`, `onFocus`, `onBlur`, `useSelectionHandler`,
  `onAnimationTick`, `useTimeline`, `<input>` and `<textarea>` events, `minWidth` other than 0, `maxWidth`,
  `alignSelf` and `flexBasis`. `ui.panel.open`, `ui.tabs.*` and `ui.model.variant.set` answer whether they did, as in TS.
  The intrinsics without a contract node (`select`, `tab_select`, `ascii_font`, `diff`, `line_number`, `image`, `video`)
  and `<Portal>` throw as they are created, which the plugin's boundary reports as TS reports a crash in a render
  (`<id> crashed in slot <path>: …`).
- **OpenTUI's exports**: the layer exports every name the installed `@opentui/core` and `@opentui/solid` export, so a
  plugin's import of one links. Beyond the colors, attributes, small data (enums, border sets) and Solid's renderer
  the layer gives, each is inert: a class constructs, extends and answers its methods with nothing, a function does
  nothing, and the first use of each warns once in the JS host's log, not in a toast, as the module cannot tell which
  plugin used it. A renderable a plugin builds itself (`new BoxRenderable(…)`) draws nothing.
- **Colors**: the context's `theme` leaves are colors that carry their token, so a node the plugin colors from the
  theme follows a theme change without a call, where an installed package's node keeps the color it read in TS. The
  `theme` object has no `hue`, `categorical` or `surface()`, and neither it nor `themeMode` is a signal.
- **Numbers** a render computes are rounded and clamped to the contract's ranges.

**Reason.** O-123 and O-125 keep plugin UI code native and in-process; O-128 makes TypeScript a compatibility shim on
the JS host, the second tier: what it cannot read in the frame, or that the contract does not carry, it reports rather
than imitates (rich-plugins synthesis 3.7).
