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
  open dialog stays and acts, as in TS (`P.8/sidebar-prompt` `kept`), and so does its session panel, which mounts again from the new registrations (CT-29: opencode-self-improvement's `/memory` panel registers keys as it renders, and the reload closed it; `plugin_compat::a_session_panel_stays_open_across_a_reload`). Each mount the
  reload ends and begins again keeps its components, which do not run again, as TS takes a registration without a
  remount (CT-21: opencode-navigator named a binding anew on each mount, `P.8/navigator`), and the field the plugin
  focused in it takes the host's focus again;
  a mount begun 250 ms after its end renders anew. A disposed `ui.slot` or `ui.router.register` draws nothing but stays registered until the
  next reload, so a disposed `replace` still holds its slot. A layer's `enabled`, its `mode` (base unless `global`; a
  mode of the plugin's own, such as `modal` or one it pushes, binds its commands everywhere, and they decline unless it
  is the input mode, CT-31: opencode-usage-report's `r`, `P.8/usage-report-keys`) and
  a command's `enabled` and slash `aliases` are kept (`P.8/file-browser` and `P.8/context-grid` `slash`); its
  `priority` and `bindings` are not mapped. A layer's and a command's `enabled` are the command's state on the host
  (contract ergonomics 2.5): a disabled command stays registered, binds no key and is in neither the palette nor the
  slash list, as TS binds no disabled command, and the layer follows what they read, telling the host each change
  with no reload (opencode-command-hotkeys' palette entries off a session, `ports_trio`). Its `target` holds
  its commands to the plugin's focus in that node, elsewhere they decline (CT-20: @slkiser/opencode-quota's window
  Escape kept Goal's select open), but the focus is the layer's record of what the plugin focused or the user edited:
  the host's focus by a click or Tab does not reach it, so a target the user clicks into still declines. A command
  without an `id` is named by what the host lists of it (its layer's mode, its keys, title, slash name and the rest) and
  its place among the layer's commands that list the same, so a component that mounts again names it as before and does
  not reload the plugin again (CT-1). Two live commands that list the same in every part are one, the newest running,
  as the topmost layer's runs in TS. A plugin whose registrations change more than 64 times within 5 s, counted for
  the plugin across its builds, as one that names a command anew on each mount does, fails with "it changed its
  registrations … and never settled", where TS would keep it running. A fetch the plugin waits for across a reload
  settles once (CT-1).
- **A key a command declines** goes on, as in TS. The JS host answers after the frame, so a key that runs a plugin's
  command holds the keys after it until the JS host answered, as TS runs a command before the next key. A command
  that returned `false`, whose `enabled` says no, or whose layer ended declines, and its key is routed again first,
  past that command and any that declined it before, to the host's own keys and the composer (CT-8: linear's `r`,
  `P.8/linear-keys`; CT-19: rundev's space and Enter, `P.8/rundev-keys`; `P.8/host-keys` has the same keys with no
  plugin). The key reaches the composer a round trip to the JS host later than TS's. A disabled command binds no key,
  so its key is never held (linear's `r` while its dialog is closed; `plugin_compat::a_disabled_commands_key_is_not_held`);
  the hold stays for a command that is enabled and declines as it runs (rundev's keys, which return `false`), and for
  an `enabled` that reads what the layer does not follow, which it asks again as the command runs. Keys no JS command
  binds are never held. A command the palette or a slash runs declines nothing.
- **The hold's bound**: a hold lasts at most 50 ms (`Config::hold`). If the JS host has not answered by then, the
  key that ran the command goes on as declined, first, then the keys after it, and the log says so once. A late
  answer still applies its effects but does not put the key back, so a command that would have taken the key after
  the limit also typed it. Declined rather than handled, so that no key is lost behind a slow JS host, and none lands
  after the keys typed since (a late Enter after more text). Until the JS host sends anything again (its
  acknowledgement of a read aside), a key that runs a JS command is not held: it goes on at once, as declined, and its
  command runs late, in its order. A
  JS host that ends, or a call it never reads, releases what it holds at once, its bound key as declined, and such
  a call is not sent again to the next JS host (`plugin_compat::a_stalled_js_host_holds_keys_no_longer_than_the_limit`,
  `plugin_compat::a_js_host_that_ends_while_keys_are_held_releases_them`).
- **`data.listen`** hears every event as `{ details }`, through one subscription of the plugin to each type the generated
  client names (`EventSubscribeInput`), made with its first listener; a type the client does not name, as a plugin's
  own `rpc.*` events, never comes. The streaming deltas (`session.*.delta`) do not come, as the host's store sends no
  plugin a delta.
- **Server RPC** (CT-4): `@opencode/plugin/rpc` gives `Rpc.define`, and so does `@opencode/plugin/effect`, whose other
  names (the server's Effect schemas, `Agent`, `Tool` and the rest) link but are undefined (CT-23:
  opencode-superagent's TUI); and `client.rpc(definition)` calls each method as
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
  the host's scroll verb.
- **Layout reads** (contract 2.x proposal, addition 1, no wire change). A node's `getLayout()` (Yoga's six fields;
  `left` and `top` against its parent, which is measured only if they are read), `width` and `height` are where the
  host laid it out (`Read::rect`); the node carries an id from the view after the plugin first asked. OpenTUI answers
  at once, where the host's layout reaches the JS host a frame later, so:
  - **R1**: a slot mount shows its placeholder and tells the JS host of the mount once a solve laid that out, so its
    first input is its room (`sidebar.content`'s 37 columns), not the terminal's size that stood in. The surface views
    again after its first solve also when the room equals the terminal's size.
  - **The room rule**: before the host laid a node out, a top node of the mount answers its own width, `"100%"` of the
    room or a number; any other node answers zero, as OpenTUI's do before their first pass. It is exact where the
    slot's container is a column; in a row (`prompt.footer.status`, `home.footer.status`) a `100%` top node answers
    the container's width, and the push corrects it a frame later. opencode-tokscope's sidebar measures itself within
    ten timer ticks and drew nothing (`P.8/tokscope-sidebar`).
  - **A fixed size**: once laid out, a node's own numeric `width` or `height` is what it answers, as the host lays it
    out at that (it does not shrink); the host's rect is of the tree before the plugin set it, a frame late.
  - **R2**: the rects the plugin watches are compared and pushed when a frame's geometry is final, after each solve
    that laid one of its mounts out, in place of a timer after each tree. `onSizeChange` runs as the laid-out size
    changes; a 0×0 read (a node the host has not laid out yet) is no size, as OpenTUI never reports one.
  - **R3**: a push may draw, lay out and push again, one round a frame. After 8 frames in a row of changed rects with
    no other cause (a call or a new input of a mount), the plugin's pushes wait for one, and the log says so once
    (`plugin_compat::a_layout_that_follows_its_own_size_is_held`).
  A plugin that reads a nested node within a few timer ticks still loses the race. Other renderable members are
  undefined.
- **Fields** (CT-11): an `<input>` or `<textarea>` hears the host's field: `onInput` each edit, `onChange` and
  `onSubmit` its submit, and `value` is what was typed. An edit gives it the plugin's focus. A field's `focus()` and
  its `focused` prop (one microtask after it changes) are the contract's focus of the field (contract 2.x,
  `focus-input`), as the request of the mount whose render holds it, whichever call runs: what the user types goes
  into it, as in TS (`P.8/file-browser`'s `typed`). A field the mount's tree does not hold yet takes the focus if the
  mount's next revision shows it, and the focus is dropped if that revision does not (nor does a later one apply it);
  a mount that closed takes nothing. A field in no mount (in a dialog of the plugin's own, removed from its mount, or
  never added) has no focus on the host, which is reported once. While the plugin's focused
  field sits in a route or a panel,
  each key there is its `onKeyDown`, through a listener layer of the surface, which takes it with `preventDefault`
  (contract gaps 2); one it does not take goes on to the host's field and keys once the JS host answered, as below.
  Only an `onKeyDown` that can take a key holds one for the JS host's answer (below); a field without one, or with one
  that only hears keys, holds none, and its typing goes to the host's field at once (cg2-1). TS's `<scrollbox>` draws a scrollbar beside its content
  and a field its placeholder in OpenTUI's color; the contract's scroll and field draw the host's (`P.8/file-browser`).
  Other field events (`onPaste`, `onKeyUp` and the rest) are reported once.
- **Keys** (CT-11): `renderer.keyInput` is an emitter whose `keypress` listeners hear each key as an OpenTUI key event,
  through one global listener layer the plugin registers with its first listener (a listener after setup reloads its
  registrations once). `useKeyboard` listens on it while its component lives. A listener takes a key with
  `preventDefault`, as in TS (contract gaps 2). TS runs listeners synchronously and the host cannot wait, so a
  handler says up front that it can take a key: its source calls `preventDefault`, or it took one before (through a
  helper; that first key went on, where TS stops it). While such a handler listens, the host holds each key but what
  the user types into the composer or another text input, and the input after it (pastes too), until the JS host
  answers, as for a key a command may decline; a key not taken goes on then, below this listener, and no listener
  hears it twice. So such a key is a round trip later than in TS, held at most the hold's limit; a key typed into a
  route that closed meanwhile goes with it. Typing in a text input, and every key while no handler can take one, is
  only heard, and goes on at once (cg2-1, cg2-2, cg2-5): a listener that would take a typed letter from the composer
  does not (FT-14 keeps a global bind off typing too). It hears keys in
  the base mode only, and none while another plugin's overlay has the focus, as the contract's global layer holds.
  `keyrelease` and `paste` never come.
- **Dialogs**: `select`, `confirm`, `prompt` and `alert` are the host's, each settled once as TS's are (an answer;
  `undefined` on escape, the backdrop, another plugin's dialog, `clear()` or the plugin's end). A select's `search`
  lists its rows for each query as TS's does (flat, in its order, the category as the footer), but the rows change
  once the JS host answered the query, not in the keystroke's own frame (`P.8/select-search`). A `dialog.set` right
  after `dialog.select`, `alert` or `confirm` sizes and centers it as in TS (contract 2.x, addition 4,
  `P.8/session-time`); one after the dialog showed is reported once. A prompt's `value` and `description` are the
  contract's (`P.8/session-manager` `rename`). A select's `actions` are the contract's footer actions, with their
  keys, side and selection, and the select stays open as one runs (`P.8/session-time`'s timeline); past 4 the rest are
  reported. `ui.dialog.show` shows the plugin's JSX
  in the host's panel dialog, bare (only the dialog's frame, as TS's), in the size and place `ui.dialog.set` gives, and
  a render that throws closes it. A panel's body is a render tree (`RenderNode`): a `<scrollbox>` in it is a box that does not
  scroll (the scroll keys say so, once), an `<input>` in it is its text, and its colors take the dialog's surface.
- **Pointer**: `onMouseDown`, `onMouseUp` and `onClick` on a box or a text run as a click of the node, with an event
  that has its kind and the left button but no position; a node with both a press and a release handler keeps the
  press (reported). `onMouseOver`, `onMouseOut`, `onMouseScroll` and `onMouseDrag` are not mapped.
- **Absolute nodes**: a render of absolute nodes alone takes its mount's box out of the flow to fill the slot's parent,
  as TS's `<Slot>` is a fragment; OpenTUI's Rust layout has no way back, so the box stays absolute if a later render
  of the claim is in the flow.
- **Not mapped**, each reported once a plugin in the client's log, by the plugin's name (`plugin <id>: <id>: <feature>
  is not supported by opencode-native yet`), and doing nothing (a list answers empty). The report is no toast: a toast
  covered the plugin's own surface until it timed out (`P.8/file-browser`'s field focus, navigator's `minWidth`), which
  TS never shows and a checkpoint saw or not by the machine's speed. Not mapped: `data.project.permission`, the location's `mcp.resource` list, `renderer` members other than
  `requestRender`, `width`, `height` and `keyInput` (a method of OpenTUI's `CliRenderer` does nothing, an emitter's
  returns the renderer and an async one a resolved promise, so `P.8/quick-switch` draws as TS),
  `usePaste`, `onFocus`, `onBlur`, `useSelectionHandler`, `onAnimationTick`, `useTimeline`, `alignSelf` and
  `flexBasis`. `minWidth` and `maxWidth` are the layout's `min_width` and `max_width`. `ui.panel.open`, `ui.tabs.*` and `ui.model.variant.set` answer whether they did, as in TS.
  `data.project.permission` has no client call to load it through and would need a contract read; the location's
  `mcp.resource` list is not mapped yet, though it could load through `client.mcp.resource.catalog` as those below.
  A `<select>` draws as OpenTUI's renderable draws it, rows of the options that fit with the selected one marked
  `▶ ` on its background (CT-14: @cleocode/goal's sidebar, `P.8/goal-select`); its keys, `onChange`, `font` and
  scroll indicator are not mapped, as the contract's focus does not reach it. The intrinsics without a contract node
  (`tab_select`, `ascii_font`, `diff`, `line_number`, `image`, `video`) throw as they are created, which the plugin's boundary reports as TS reports a crash in a render
  (`<id> crashed in slot <path>: …`). `<Portal>` draws its children in a box that fills the room of the mount that
  renders it, over the rest, which its `ref` gets as the container (CT-10): in the `app` slot that is the screen, as
  TS's renderer root (opencode-landstrip's pane); elsewhere it is the slot's room, not the screen, and its `mount` is
  not followed (opencode-sesh's menu draws over its sidebar section). Drawing over the whole screen from another slot
  would need the contract to let a mount place a node outside its room. The TS TUI's own `<spinner>` is the contract's spinner, in the host's frames,
  pace and color; its `frames`, `interval`, `color`, `backgroundColor` and `autoplay` are reported (CT-14).
  `renderer.root` takes nothing, and `renderer.currentFocusedEditor` and `currentFocusedRenderable` are undefined,
  each reported as it is read, so a plugin that checks they exist starts (CT-17: opencode-dollar-skills). What such a
  plugin then does with the composer's editor (opencode-vim-navigation's modal editing, dollar-skills' completion)
  would need the composer as a renderable a plugin edits, where the contract has only `ComposerEdit`.
- **Code-block renderers** (contract 2.x, addition 3, step D): `markdown.registerCodeBlockRenderer(language, render)`
  is a fence claim of the host's, registered by the filetype the language resolves to (OpenTUI's own maps and
  `infoStringToFiletype`); a second registration of a filetype by the plugin throws, as in TS, and across plugins the
  last wins, an external plugin after the built-ins (good-fences takes `latex` from the built-in LaTeX, as in TS).
  `render` gets the fence as OpenTUI's Markdown gives it (`lang`, `text`, `raw`) and a context whose `defaultRender()`
  is the host's own code view of the fence (`Node::Fence`), whose `bg` it may set, also its code's; any other write to
  it is reported. It returns a renderable built with `new` (below), or nothing to keep the host's view.
  - **After the frame**: the renderer runs on the JS host, so a fence shows the host's code view in the frame it
    first shows, and the plugin's tree once the JS host answered, a frame or more later; the transcript may shift
    once a fence (good-fences adds the label's row). TS draws the plugin's from the start. While the fence streams its
    code follows in the frame, and a tree that drew the code itself is a round trip behind (`P.8/good-fences`).
  - **A renderer that throws** falls its part back to the host's code view for the part's mount, with one toast
    (`<id> crashed in code block <language>: …`); the plugin stays active, where TS throws on out of Markdown's build.
  - **Bounds** (host policy): a plugin holds 256 claims (good-fences registers about 60; TS has none); a fence whose
    code is over 256 KiB keeps the host's code view, logged once a plugin; a part waits, the host's view showing,
    while the queue to the JS host is backed up, and is sent as it drains. What a renderer asks the host for as it
    draws (a toast, a fetch) is dropped, logged once: a claim's view reads only, on every carrier.
  - The renderer's context has no `syntaxStyle` or `treeSitterClient`; a click on a node of its tree runs nothing
    (reported), as a claim has no handler.
- **The `data` collections the contract has no read of** (`data.project`, `data.shell`, `data.session.permission`,
  `data.session.form`, the location's `agent`, `command`, `reference` and `skill` lists) load through the plugin's
  `client` over the host's fetch: as the plugin first lists or syncs one, on `invalidate`, and on each event that
  changes it (`agent.updated`, `permission.asked`, `form.replied`, …); `form.reply` and `cancel` go through
  `client.session.form` and load the list again. A list answers `undefined` until its load came, where TS's store
  answers what it holds, and nothing keeps it live between events (`P.8/skills-data`: opencode-skills-tui's skills).
  A live store would need the contract to give a plugin these collections as reads.
- **OpenTUI's exports**: the layer exports every name the installed `@opentui/core` and `@opentui/solid` export, so a
  plugin's import of one links. Beyond the colors, attributes, small data (enums, border sets), Solid's renderer, and
  styled text (`StyledText`, `t`, `fg`, `bg`, `bold` and the other attribute helpers, `link`, `stringToStyledText`,
  which a text node's `content` draws chunk by chunk, CT-27: @encoredigitalgroup/opencode's panels drew
  "[object Object]"; its tarball is proprietary, so a layer test pins it) the layer gives, each is inert: a class constructs, extends and answers its methods with nothing, a function does
  nothing, and the first use of each warns once in the JS host's log, not in a toast, as the module cannot tell which
  plugin used it. A renderable a plugin builds itself (`new BoxRenderable(renderer, options)`, and `TextRenderable`,
  `MarkdownRenderable`, `CodeRenderable`, `ScrollBoxRenderable`, `InputRenderable`) is the node its JSX intrinsic makes,
  with its options as its props, `add`, `insertBefore`, `remove` and the option setters, and draws as that JSX would:
  returned from a code block's renderer, from a render, or added to a node by its ref (contract 2.x, step D; CT-15,
  opencode-quick-quote returns one as its slot's element, opencode-gpt-live and opencode-task-completion-loop the same,
  not checked one by one). What OpenTUI does with the renderer it is given is the host's. A call of a method any of OpenTUI's
  declarations returns a promise from answers a resolved promise of an inert value, so a chain such as
  `getTreeSitterClient().initialize().then(…)` runs on (CT-16, `P.8/shell-highlighting`): the grammar it registers is
  not the host's, which would need the contract to take a plugin's tree-sitter grammar. The `effect` package is not
  served (O-170): the layer serves what the TUI plugin API defines, not libraries a plugin expects the host to happen
  to have. TS's runtime provides its own, so a plugin that imports it (opencode-plugboard and
  @davidaayers/opencode-codex-usage-plugin declare it a peer) fails to load here, named
  (`plugin_compat::a_plugin_that_imports_effect_fails_to_load_naming_it`).
- **Shrink and wrap**: a node with a fixed `width` or `height` does not shrink unless its `flexShrink` says so, as
  OpenTUI's renderables (CT-25: @wpro-eng/opencode-config's 14-cell agent names shrank to their text; its tarball is
  unlicensed, so a layer test pins it). Where a long word breaks is the host's text wrap: TS's breaks
  `github-copilot/gemini-3.8-flash` after the `/`, the host's after `gemini-`, which is OpenTUI's Rust wrap, not the
  layer's. A panel sized by its box's width (CT-28: opencode-tui-context's gauges and legend, `P.8/context-gauge`)
  draws as TS once the host's layout reaches it (above).
- **Dialog size**: `dialog.set({ size, centered })` sizes a `ui.dialog.show` dialog, and an `alert`, a `confirm` or a
  `select` it follows right away (above; CT-35's joe-broadhead status alerts are `large`, as in TS).
- **Border titles**: a box's `title`, `titleAlignment`, `bottomTitle` and `bottomTitleAlignment` are the contract
  border's (CT-26: @juliuskb/opencode-voice's CPU and memory line, `P.8/voice-title`). An `onSizeChange` a plugin sets on the
  renderable by its ref runs as one set as a prop does, so voice spreads its top title across the panel's width as
  in TS. That row's requests differ: the plugin polls its status RPC on a timer, which runs in real time on the JS
  host, so the replay sends more polls.
- **Colors**: the context's `theme` leaves are colors that carry their token, so a node the plugin colors from the
  theme follows a theme change without a call, where an installed package's node keeps the color it read in TS. Its
  `hue` scales and `categorical` list are the page theme's, each step carrying the contract's token of it
  (`accent.500`, `categorical.3.300`), and a stateful color has TS's `state` (CT-9, `P.8/context-hue`). `source`,
  `increase` and `decrease` find a color's step by its token, else by its value among the named hues, where TS matches
  the object a token was read from; a color that two steps share is the first hue's. Its `surface("dialog")` and
  `surface("dialog.footer")` are the host's raised surfaces (CT-8, CT-22, `P.8/tavily-surface`): a color the surface
  gives differently from the page is that color, carrying no token, as the contract names none of a raised surface,
  so it keeps that color across a theme change; the others keep their page token. Another name is the page's theme,
  which the JS host's log says once. Neither `theme` nor `themeMode` is a signal.
- **The context's `location`** is the directory and workspace the host works in (`abi::Info.location`), where TS's is
  the whole location the server answers, its project with it: an RPC call that passes it sends the directory alone in
  its `location` query. It would need the contract to give a plugin the location's project.
- **Numbers** a render computes are rounded and clamped to the contract's ranges.
- **Raw writes to standard output** (`fs.writeSync(1, …)`, as oc-bg-color-sync writes `OSC 11` and `OSC 111` to set
  and reset the terminal's background) reach the terminal in TS, where the plugin runs in the TUI's process. Here they
  are logged, escaped, by the plugin whose code ran as they were written (`js host: plugin <id> wrote N bytes to standard
  output, …`), and change nothing on screen; the JS host and its plugins keep running. Forwarding them would need
  OpenTUI to write them between its frames, so they cannot cut into one (js-stdio).

**Reason.** O-123 and O-125 keep plugin UI code native and in-process; O-128 makes TypeScript a compatibility shim on
the JS host, the second tier: what it cannot read in the frame, or that the contract does not carry, it reports rather
than imitates (rich-plugins synthesis 3.7).
