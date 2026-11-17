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
(settled pictures, not every state or the first frame after each event). The JS host is on unless
`OPENCODE_PLUGIN_JS` is `0`, `false` or `off` (O-166). What differs:

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
  a command's `enabled` are kept; its `priority`, `bindings`, `target` and slash `aliases` are not mapped. A command
  without an `id` is named by what the host lists of it (its layer's mode, its keys, title, slash name and the rest) and
  its place among the layer's commands that list the same, so a component that mounts again names it as before and does
  not reload the plugin again (CT-1). Two live commands that list the same in every part are one, the newest running,
  as the topmost layer's runs in TS. A plugin whose registrations change more than 64 times within 5 s, counted for
  the plugin across its builds, as one that names a command anew on each mount does, fails with "it changed its
  registrations … and never settled", where TS would keep it running. A fetch the plugin waits for across a reload
  settles once (CT-1).
- **`data.listen`** hears every event as `{ details }`, through one subscription of the plugin to each type the generated
  client names (`EventSubscribeInput`), made with its first listener; a type the client does not name, as a plugin's
  own `rpc.*` events, never comes. The streaming deltas (`session.*.delta`) do not come, as the host's store sends no
  plugin a delta.
- **Server RPC** (CT-4): `@opencode/plugin/rpc` gives `Rpc.define`, and `client.rpc(definition)` calls each method as
  TS's client does (`/api/rpc/<id>/<method>`, the output answered), with its events heard as the host's events of type
  `rpc.<id>.<name>`. An error the server gives an RPC reaches the plugin as the client's error, not as TS's
  `{ type, message, data }`, as the host's fetch answers an error as text. Every module the layer serves is also
  `opentui:runtime-module:<specifier>`, encoded or not, as OpenTUI's runtime registry names it (CT-3).
- **`client` replies** whose JSON is up to just under 6 MiB (6,290,082 bytes at the default limits, as its parts in
  base64 and their envelopes fill the JS host's 8 MiB overflow) arrive whole, in parts of a frame each, while nothing
  waits before them; behind a backlog, less (CT-5). One past that fails with "the reply is N bytes, more than the JS
  host takes", where TS has no limit.
- **Elements** (CT-2) are event emitters, as OpenTUI's renderables are: `focus()` and `blur()` of a `<scrollbox>` are
  the host's focus of the node, any node emits `focused` and `blurred` as OpenTUI's do, and other events are heard and
  never come. A scroll box's `scrollTop`, `scrollHeight` and `viewport` are the host's state of the scroll once it came
  (before, the viewport's height is `Infinity`, so a plugin scrolls nothing by it), and `scrollTo` and `scrollBy` are
  the host's scroll verb. Other renderable members are undefined: `getLayout()`, which opencode-tokscope's sidebar
  measures itself by within a few timer ticks and draws nothing without, would need the node's layout as the plugin
  asks; the contract's `Read::rect` answers from the last settled frame, which reaches the JS host later.
- **Fields** (CT-11): an `<input>` or `<textarea>` hears the host's field: `onInput` each edit, `onChange` and
  `onSubmit` its submit, and `value` is what was typed. An edit gives it the plugin's focus. The contract's focus takes
  only a node with `interact.focusable`, so the host refuses a field's `focus()`, which is reported once: the plugin
  holds its own focus of it, but what the user types goes elsewhere until the user moves into the field. It would
  need `Host::focus` to accept a field (`Node::Input`). While the plugin's focused field sits in a route or a panel,
  each key there is its `onKeyDown`, through a listener layer of the surface: the key also goes on to the host's
  field and keys, as a listener cannot take it (`preventDefault` says so once in the JS host's log). It would need the
  contract to answer a listener's key after the JS host does. TS's `<scrollbox>` draws a scrollbar beside its content
  and a field its placeholder in OpenTUI's color; the contract's scroll and field draw the host's (`P.8/file-browser`).
  Other field events (`onPaste`, `onKeyUp` and the rest) are reported once.
- **Keys** (CT-11): `renderer.keyInput` is an emitter whose `keypress` listeners hear each key as an OpenTUI key event,
  through one global listener layer the plugin registers with its first listener (a listener after setup reloads its
  registrations once). `useKeyboard` listens on it while its component lives. As a listener, the plugin cannot take a
  key: it hears it and the key goes on (`preventDefault` says so once in the log), where TS stops it. It hears keys in
  the base mode only, and none while another plugin's overlay has the focus, as the contract's global layer holds.
  `keyrelease` and `paste` never come.
- **Dialogs**: `select`, `confirm`, `prompt` and `alert` are the host's, each settled once as TS's are (an answer;
  `undefined` on escape, the backdrop, another plugin's dialog, `clear()` or the plugin's end). A select's `search`
  lists its rows for each query as TS's does (flat, in its order, the category as the footer), but the rows change
  once the JS host answered the query, not in the keystroke's own frame (`P.8/select-search`). A `dialog.set` right
  after `dialog.select` sizes the select as in TS; its `centered` is not mapped for a select, which the host places
  as its own selects, where TS centers it (opencode-session-time's `/time`). It would need `abi::Select` to carry
  `centered`, as `abi::Panel` does, and the host to place a centered select in the middle of the screen. A select's
  `actions` and
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
  opencode-native yet`) and doing nothing (a list answers empty): `markdown.registerCodeBlockRenderer`, `data.project`,
  `data.shell`, `data.session.permission`, `data.session.form`, the
  location's `agent`, `command`, `mcp.resource`, `reference` and `skill` lists, `renderer` members other than
  `requestRender`, `width`, `height` and `keyInput` (a method of OpenTUI's `CliRenderer` does nothing, an emitter's
  returns the renderer and an async one a resolved promise, so `P.8/quick-switch` draws as TS with the toast beside),
  `usePaste`, `onFocus`, `onBlur`, `useSelectionHandler`, `onAnimationTick`, `useTimeline`, `minWidth` other than 0,
  `maxWidth`,
  `alignSelf` and `flexBasis`. `ui.panel.open`, `ui.tabs.*` and `ui.model.variant.set` answer whether they did, as in TS.
  A code block renderer (opencode-good-fences) would need two contract additions: the JS host to register a fence
  claim whose rows it answers after the frame, the host's code view showing until they come (a claim answers within
  the frame today, which the JS host cannot), and a node that stands for the host's own code view, which the
  renderer's `defaultRender()` returns; its renderables built with `new` would also need to draw (below).
  The intrinsics without a contract node (`select`, `tab_select`, `ascii_font`, `diff`, `line_number`, `image`, `video`)
  and `<Portal>` throw as they are created, which the plugin's boundary reports as TS reports a crash in a render
  (`<id> crashed in slot <path>: …`). The TS TUI's own `<spinner>` is the contract's spinner, in the host's frames,
  pace and color; its `frames`, `interval`, `color`, `backgroundColor` and `autoplay` are reported (CT-14).
  `renderer.root` takes nothing, and `renderer.currentFocusedEditor` and `currentFocusedRenderable` are undefined,
  each reported as it is read, so a plugin that checks they exist starts (CT-17: opencode-dollar-skills). What such a
  plugin then does with the composer's editor (opencode-vim-navigation's modal editing, dollar-skills' completion)
  would need the composer as a renderable a plugin edits, where the contract has only `ComposerEdit`.
- **OpenTUI's exports**: the layer exports every name the installed `@opentui/core` and `@opentui/solid` export, so a
  plugin's import of one links. Beyond the colors, attributes, small data (enums, border sets) and Solid's renderer
  the layer gives, each is inert: a class constructs, extends and answers its methods with nothing, a function does
  nothing, and the first use of each warns once in the JS host's log, not in a toast, as the module cannot tell which
  plugin used it. A renderable a plugin builds itself (`new BoxRenderable(…)`) draws nothing, and adding one to a node
  by its ref adds nothing and is reported (CT-15: opencode-quick-quote). A call of a method any of OpenTUI's
  declarations returns a promise from answers a resolved promise of an inert value, so a chain such as
  `getTreeSitterClient().initialize().then(…)` runs on (CT-16, `P.8/shell-highlighting`): the grammar it registers is
  not the host's, which would need the contract to take a plugin's tree-sitter grammar. The `effect` package is not
  among the modules the layer serves (CT-13), where TS's runtime provides it.
- **Colors**: the context's `theme` leaves are colors that carry their token, so a node the plugin colors from the
  theme follows a theme change without a call, where an installed package's node keeps the color it read in TS. Its
  `hue` scales and `categorical` list are the page theme's, each step carrying the contract's token of it
  (`accent.500`, `categorical.3.300`), and a stateful color has TS's `state` (CT-9, `P.8/context-hue`). `source`,
  `increase` and `decrease` find a color's step by its token, else by its value among the named hues, where TS matches
  the object a token was read from; a color that two steps share is the first hue's. Its `surface(name)` answers the
  page's theme, not the raised surface's, and says so once (CT-8); neither it nor `themeMode` is a signal.
- **Numbers** a render computes are rounded and clamped to the contract's ranges.
- **Raw writes to standard output** (`fs.writeSync(1, …)`, as oc-bg-color-sync writes `OSC 11` and `OSC 111` to set
  and reset the terminal's background) reach the terminal in TS, where the plugin runs in the TUI's process. Here they
  are logged, escaped, by the plugin whose code ran as they were written (`js host: plugin <id> wrote N bytes to standard
  output, …`), and change nothing on screen; the JS host and its plugins keep running. Forwarding them would need
  OpenTUI to write them between its frames, so they cannot cut into one (js-stdio).

**Reason.** O-123 and O-125 keep plugin UI code native and in-process; O-128 makes TypeScript a compatibility shim on
the JS host, the second tier: what it cannot read in the frame, or that the contract does not carry, it reports rather
than imitates (rich-plugins synthesis 3.7).
