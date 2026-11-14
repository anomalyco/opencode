# F16: a V2 TUI plugin on the JS host, through the compatibility layer (P8)

**TypeScript.** A `{ id, setup }` module's setup gets the V2 context (`packages/tui/src/plugin/api.tsx`), and its JSX
renders through `@opentui/solid` into the TUI's own renderables, in the TUI's process. Its reads are the TUI's store,
synchronous. A module under `node_modules` (an installed package) compiles with Bun's JSX transform, whose props are
read once as the component is created; a local module compiles with Solid's compiler, whose props follow their signals
(`@opentui/solid/scripts/solid-plugin.js`).

**Rust.** The JS host gives the module the same context and the modules TS gives it (`@opencode/plugin/tui`, Solid,
`@opentui/solid`, `@opentui/core`), from the compatibility layer (`crates/plugin/src/pipe/compat`). Its JSX renders with
Solid's universal renderer into plain nodes, which each view reads into a contract 2.0 tree for the host to draw. The
four published packages P8 runs draw cell for cell as TS draws them (`parity/scenarios/P.8`). What differs:

- **Every module compiles as an installed one**, with Bun's JSX transform: a local TSX plugin that relies on Solid's
  compiler for props that follow signals renders them once, as the same plugin installed from npm does in TS. A
  function child, a `ref` and a memo follow their signals as in TS.
- **Reads are snapshots** the host pushes. A render that read one the host has not pushed yet renders again once it
  came, at most three times; after that a read that is late shows in a render only if the plugin's JSX follows it.
- **An async setup that waits on the host** (a `client` call, a `sync`) hands the plugin to the host at its first such
  wait, with what it registered so far; what it registers after is taken as a reload of its registrations, and a throw
  after fails the plugin, where TS keeps the plugin inactive until setup resolves.
- **A command a component registers** (`keymap.layer` in a render) goes 250 ms after the component's mount ends, unless
  a new mount registered it again: the host remounts after a reload in a later message.
- **Dialogs**: `select`, `confirm`, `prompt` and `alert` are the host's. One the user closes with escape answers
  `undefined` only when the next dialog opens (the host runs nothing for it); TS answers at once. A select's `search`
  and `actions` are not mapped. `ui.dialog.show` shows the plugin's JSX in the host's panel dialog, bare (only the
  dialog's frame, as TS's), in the size and place `ui.dialog.set` gives; a panel's body is a node of ABI 1.x, so a
  `<scrollbox>` in it is a box that does not scroll, and an `<input>` in it is its text.
- **Pointer**: `onMouseDown`, `onMouseUp` and `onClick` on a box or a text run as a click of the node, with an event
  that has no position. `onMouseOver`, `onMouseOut`, `onMouseScroll` and `onMouseDrag` are not mapped.
- **Absolute nodes**: a render of absolute nodes alone takes its mount's box out of the flow to fill the slot's parent,
  as TS's `<Slot>` is a fragment; OpenTUI's Rust layout has no way back, so the box stays absolute if a later render
  of the claim is in the flow.
- **Not mapped**, each reported once a plugin with a warning toast (`<id>: <feature> is not supported by
  opencode-native yet`) and doing nothing: `markdown.registerCodeBlockRenderer`, `data.listen`, `data.project`,
  `data.shell`, `data.session.permission`, `data.session.form`, the
  location's `agent`, `command`, `mcp.resource`, `reference` and `skill` lists, `renderer` members other than
  `requestRender`, `width` and `height`, `useKeyboard`, `usePaste`, `onFocus`, `onBlur`, `useSelectionHandler`,
  `onAnimationTick`, `useTimeline`, `<input>` and `<textarea>` events, `minWidth` other than 0, `maxWidth`,
  `alignSelf` and `flexBasis`. `ui.panel.open`, `ui.tabs.*` and `ui.model.variant.set` answer whether they did, as in TS.
  The intrinsics without a contract node (`select`, `tab_select`, `ascii_font`, `diff`, `line_number`, `image`, `video`)
  and `<Portal>` throw as they are created, which the plugin's boundary reports as TS reports a crash in a render
  (`<id> crashed in slot <path>: …`).
- **`data.session.pending`** lists nothing, quietly, as a session whose inbox is empty: the host's inbox is not a read.
- **Colors**: the context's `theme` leaves are colors that carry their token, so a node the plugin colors from the
  theme follows a theme change without a call, where an installed package's node keeps the color it read in TS.

**Reason.** O-123 and O-125 keep plugin UI code native and in-process; O-128 makes TypeScript a compatibility shim on
the JS host, the second tier: what it cannot read in the frame, or that the contract does not carry, it reports rather
than imitates (rich-plugins synthesis 3.7).
