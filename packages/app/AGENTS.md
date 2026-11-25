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
- On hot paths (scroll, pointer, resize, streaming), keep the machine allocation-free: return the same object when nothing changes, reuse event objects, and keep frozen singleton states. Benchmark with strobe as the Priorities section requires. Shared or frozen singleton states are safe only in signals and plain variables. Solid store writes (`setStore(path, obj)`, `reconcile`) merge into the object already in the store, so state written into a store never shares an object between two entries or with a module constant: replace it whole (`produce` replacement, or a signal), or build fresh objects with a factory (`createFileTreeState()`), and test through the real store with two entries.
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

## Floating surfaces over native pages

A native page view, such as the browser pane's, paints above every DOM element, so `src/runtime/plugin/embeds.tsx` hides it while floating app UI overlaps it.

- Mark the painted box of a floating surface with `data-floating-overlay` for its whole visible lifetime, including its exit animation. Mark the surface, not a full-window transparent portal wrapper.
- Popper positioners, `aria-modal` dialogs, open `<dialog>` elements and open popovers count without the marker. Tooltips never cover the page.
- A positioned surface that takes pointer input and is portalled to `document.body` after the app root also counts without the marker. It is a fallback: mark new surfaces.

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

## Timeline stability

This section is the single source for what may move or restyle the session timeline. It applies to every component and stylesheet that renders in or around the timeline, across `app`, `ui`, `session-ui` and `gui-plugins`. Each rule comes from a regression that shipped.

### Scroll position

- The timeline moves when the reader scrolls it or asks to go somewhere (a jump, a search hit, a link). Nothing else scrolls it: not focus, not an update, not a row that mounts.
- `element.focus()` scrolls its element into view. When code moves focus inside a scroll container, pass `{ preventScroll: true }` unless the reader must see that control next: keyboard navigation to it, or the item that takes the place of a removed one.
- A virtualized row unmounts when it scrolls out of range, and a control that holds focus goes with it. Chromium then leaves focus on `<body>`, and the focus rescue (`packages/ui/src/context/focus-rescue.tsx`) handles the row as a deleted item: it focuses a control in another row, and the browser scrolls the timeline there. After a click on one tool header, the timeline jumped 13 times in 8 wheel bursts.
- A virtualized list therefore gives focus to its own viewport, without scrolling, before a row that holds focus unmounts. `VirtualRow`'s `onCleanup` in `src/session/timeline/virtualizer.tsx` does this. Keep it when you change how rows mount, and do the same in a new virtualized list.
- Keeper: "a focused control that scrolls out of the mounted rows leaves the timeline where it was scrolled" in `e2e/regression/session-timeline-accessibility.spec.ts`.
- To check by hand: click a tool header, a link and a notice in the timeline, then scroll up and down with the wheel. The timeline must follow the wheel.

### A view that is not shown

- A timeline that is not shown is out of the document: behind another view on a narrow screen, in a window that narrows onto the view it last showed there, or while another session is selected. Its scroll element loses its offset there and comes back at 0. Out of the document it also measures as empty: `scrollTop`, `scrollHeight` and `clientHeight` all read 0.
- The virtualizer's offset is the reader's place while the view is away. TanStack moves that offset with the row under it when an older page lands above, so it names the same rows when the view returns. `restoreOffset` in `src/session/timeline/virtualizer.tsx` writes it back to the element once the element is back (`returning` in `src/session/timeline/reconnect-machine.ts`). A view that follows goes to its end instead. Before, the element's 0 was reported to the virtualizer, and a reader who had scrolled up came back to the start of the loaded history.
- Only a view that returns has a place to go back to. A view that is put in the page for the first time holds the offset it was built with: the furthest there is when it was built following, which no reader was at. That offset is never written to the element.
- Do not report the native offset of a returned element to the virtualizer before that write. Do not save a native offset to restore later either: the same number names other rows once history has loaded above.
- Check `isConnected` before code decides anything from scroll geometry. The history probes in `src/session/timeline/interaction.ts` read the empty element as room to fill and as a reader at the top, and loaded one older page after another for as long as the view was not shown.
- A session keeps its place too. A reader who had scrolled up in a session comes back to the same rows; one who followed comes back to the end, and to the new end if the session grew meanwhile. A `#message-<id>` link still wins. Before, every switch opened the session at its latest message.
- The place is a bookmark kept for each session, apart from the views and the row sizes (`src/session/timeline/place.ts`): the key of the row at the top of the view, how far into it the view begins, and the keys of the four rows on each side. A view keeps it as it goes away with its reader off the end (`depart` in `virtualizer.tsx`); a session whose reader followed has none. 128 sessions keep one. The 16 kept views and the 16 sets of row sizes go long before that, and a session opened by a route change, not by its tab, builds the session screen again each time.
- A session with a bookmark starts out away from the end (`src/session/timeline/follow.ts`). The view that returns takes the bookmark once and goes back to it (`putBack`): to its row; when that row is gone, to the nearest remembered row after it, then to the row after the nearest one before it; when what is left of the session ends before the place, to the end, and the reader follows from then on (`resolvePlace`).
- A view that is built again has no row sizes, and the header and the composer settle after it is shown. The return therefore puts the view at its place again on each frame and after each batch of sizes, for 3 seconds, by where the row is drawn (`src/session/timeline/place-machine.ts`). A kept view gets its own offset back first (`restoreOffset`), and the bookmark agrees with it unless rows were removed.
- The reader's own scroll wins. A wheel, key, touch, press or navigation ends a return that has not finished (`PLACE_TAKEN_EVENT`). Do not write a kept place to the element outside that machine.
- Read the bookmark from the list's numbers as the view goes away, not from the page: the view is out of the page by then, and a reader can leave before their scroll has settled. Those numbers count from the space above the first row, which a window that crosses a breakpoint changes before the view leaves; `here` corrects for it.
- A view that is not shown reads its own reader's follow state, not the selected session's (`follows` in `virtualizer.tsx`).
- The bookmark also names what the reader was on: a letter, by its row and by how many letters of the row's text come before it, with where its top was on the screen (`letter` in `place.ts`). It comes from the reading the view takes each time a scroll comes to rest (`reading` in `virtualizer.tsx`), because a text node does not outlive its view and nothing can be read from the page as the view goes away. The letter goes back where it was on the screen, so the same words are there after the rows wrap again at another width. A reader who left before their scroll came to rest, or who was on no text, has the row and the distance in pixels only, which a new width moves.
- A reload does not keep the place. After a reload only the newest page is loaded and no row has a size, so the row is often not there to return to; a `#message-<id>` link is the place that survives a reload.
- Keepers: "returns a reader to the rows they left …" in `e2e/regression/timeline-cache.spec.ts`, from another narrow-screen view, under an older page that landed while another view showed, when the window narrows onto another view and widens again, from another session's tab, from Home in a view that is built again, and after 34 other sessions were opened; "returns a reader to the words they left after the window narrowed while they were away", "returns a reader whose passage was removed meanwhile to the end, which they follow from then on" and "returns a reader who followed to the new end of a session that grew meanwhile" in the same file; `src/session/timeline/place.test.ts`, `place-machine.test.ts` and `test-browser/timeline-place.test.ts`; "a session opened without a hash leaves a reader who had scrolled up in it where they were" in `src/session/timeline/cursor-machine.test.ts`; "asks for no older page while the conversation is behind another narrow-screen view" in `e2e/regression/timeline-history.spec.ts`; "reveals ready measured rows after an offset-only reconnect" and "reveals a view that no longer follows at its start when it is first put in the page" in `component-tests/timeline-virtualizer.spec.ts`; "tells a view's first attachment from its return" in `src/session/timeline/reconnect-machine.test.ts`.
- To check by hand: at a width under 768 px, scroll up into history, open Changes and come back. Then widen the window with Changes open, scroll up, and narrow and widen it again. Then open another session's tab and come back, and go Home and Back. The same rows must be in the same place each time.

### Scroll writes

- A native scroll write (`scrollTo`, `scrollTop =`) forces a layout when anything is dirty. TanStack corrects the scroll position once for each row it resizes above the view, so a batch of measured rows forced one layout for each row.
- `scrollToFn` in `src/session/timeline/virtualizer.tsx` holds the corrections made while a batch of sizes is applied and writes the last one once. Keep scroll writes for size changes on that path, and call `flushHeldScroll` before code inside the batch reads the native offset.
- Two writes for something other than a row's size do not go through `scrollToFn`: `flushTouchAdjustment`, and `keepOrigin` (see "Rows that change height under the reader"). `keepOrigin` writes once when a layout moves the place where the list starts on the screen, such as the 768px breakpoint, and not for each row. It runs before a batch holds its corrections, and the batch reads the rows' boxes right after it, so the write cannot wait for the batch to end. Both sit between `readScroll` and `syncScroll`, so the follow ledger counts them as the timeline's own, and both report the new offset to TanStack. Do not add a third.
- Keeper: "corrects the scroll position once for each batch of rows an older page measures" in `e2e/regression/timeline-history.spec.ts`.

### Following the end

- The follow state (`src/session/timeline/machine.ts`) decides whether the timeline holds the newest content at the bottom. It stops when the reader scrolls up, and it resumes when the reader scrolls to the end.
- A scroll range that shrinks moves the offset without the reader: the browser clamps the offset to the new end. For a view that navigation or a selection sent somewhere (the `detach` event), that is not a return to the end. A cold link to a message detached the timeline, the rows' real sizes then shortened the range, and the clamp counted as an arrival: the session opened on its latest message and dropped the link's hash.
- A reader who scrolled away and whom a clamp brings to the end follows again. At the end a wheel toward it scrolls nothing, so that reader would have no other way back.
- Apart from that clamp, a reader who left the end is back at it only by a scroll of the reader's own (`event.reader`). A scroll of the timeline's own that ends at the end is not the reader's return. Its scroll event can arrive after the wheel that left the end: the timeline then followed again for a frame and cleared the route's hash. The page that PageUp and PageDown in the composer scroll is the timeline's write for the reader's key, so `setPage` counts it as the reader's.
- The timeline learns that the reader scrolled from the scroll, not from the input device. `readScroll` in `src/session/timeline/virtualizer.tsx` counts each movement of the offset as the reader's, unless a scroll write of the timeline made it or the browser clamped it. Middle-click autoscroll, Ctrl+Home, PageUp on a control in a row and the scrollbar have no handler. Each one left the timeline following, and the next streamed line pulled the reader back to the end.
- Put each scroll write that the timeline makes between `readScroll` and `syncScroll`. A write outside them counts as the reader's scroll: upward, it stops following.
- A view that is not shown leaves the document and comes back at offset 0. That is not the reader scrolling to the top: the ledger starts over at the first read after the view returns (`seen.lost`).
- A component in a row that scrolls the timeline to hold a control in place makes that write through `holdScroll` (`@opencode/ui/hold-scroll`), and in no other way. The virtualizer owns the scroll element (`ownScroll`) and runs the write between `readScroll` and `syncScroll`, so it is one of the timeline's own. See `change` in `packages/session-ui/src/tools/tool-renderer.tsx` and `flip` in `packages/session-ui/src/message/message-content.tsx`. Folding a long prompt at the end scrolled up to hold its toggle, straight on the scroll element: the timeline took that for the reader leaving, and the reply that streamed next stayed out of view. A scroll that takes the reader somewhere, such as a link in a reply, is the reader's and leaves the end: it does not go through `holdScroll`.
- A wheel or scroll key toward the end that lands within `REJOIN_DISTANCE` of it follows again: a reply that streams moves the end away while the scroll is on its way there. Navigation that lands there does not follow, because that would scroll its target away. The same landing gives the same result wherever the input went. The session header and the jump button lie over the timeline, and a wheel over them scrolls it without an event on the scroll element, so the wheel is heard on the whole view (`handleViewWheel`): a wheel over the header left the view 40px short of a reply that went on streaming. PageDown in the composer lands the same way, because its page is the reader's movement. A wheel with no vertical distance, such as a sideways one, moves nothing in the timeline and is not the reader scrolling.
- The glide to the latest message is the timeline's own animation (`glide` in `src/session/timeline/virtualizer.tsx`), not the browser's smooth scroll. The browser's glide heads for where the end was, and it starts again from rest at each new target. A reply that streams cut it short: the next row measurement jumped the rest of the way in one frame. While the timeline glides (`isGliding`), nothing else may jump the view to the end, and the reader's scroll away ends the glide. A scroll that would jump it holds the view at the glide's distance from the end instead (`placeGlide`), so history that loads above the view does not show.
- TanStack's scroll to the end aims at the last row by its index and keeps correcting for up to 5 s. An older page that loads meanwhile gives that index to a row in the middle of the history. With the browser's smooth scroll, Jump to latest pressed while a page loaded ended thousands of pixels from the end. Do not start a smooth TanStack scroll to the end.
- The reader's input also ends TanStack's scroll to a target (`stopScroll`), which TanStack writes again when a measurement moves the target. A scroll to the end keeps running only while the timeline still follows the end.
- Keepers: "stays where navigation sent the view when a shrinking scroll range clamps it to the end" in `src/session/timeline/machine.test.ts`; "the glide to the latest message outlasts a streamed line", "the glide to the latest message yields to the reader's wheel", "keeps a reader who left the end with … in place while the reply streams", "goes on following the reply after a group collapses from its stuck header", "goes on following the reply after a long prompt folds from its toggle" and "follows again when … lands within reach of the end" in `e2e/regression/timeline-stream.spec.ts`; "Jump to latest glides on while an older page loads above the view" in `e2e/regression/timeline-history.spec.ts`.
- To check by hand: in a session that streams, leave the end with Ctrl+Home, the scrollbar, middle-click autoscroll, and PageUp after a click on a tool header. The timeline must stay where each one put it, and must follow again after End.

### Rows that change height under the reader

- What stays where it is depends on what is known. `shouldAdjustScrollPositionOnItemSizeChange` in `src/session/timeline/virtualizer.tsx` owns the whole rule for a row whose measured size changes, and the size batch in `virtualizer.resizeItem` prepares what it reads (`aboveLine`, `still`). Do not add another place that corrects the scroll position for a row's size. A component that holds its own control in place while its row resizes writes through `holdScroll` (see the follow section above); the reader pressed in that row, so the rule here leaves the row its top edge.
- What the reader sees is the scroll port: the viewport less its scroll padding, from the fade under the session header to the composer region. The reading line is 40% of the way down it.
- **What the reader is on** (`reading`) is the content at the reading line: the letter nearest the middle of the line, as a text position, or the element there when no letter is within 32 px. An element is held by its top. `atReadingLine` finds it and keeps nothing; `takeReading` keeps it for the rule.
  - It is taken once for each rest: when the reader's scroll has come to rest (TanStack reports a settled offset 150 ms after the last scroll event) and the frame after that has rendered (`lookAfterRender`). It cannot wait until it is needed: the size batch that needs it runs after the layout has already moved the letters. It is dropped when the reader scrolls. It is never taken in a frame of a scroll, and nothing reads it but a size batch, before the batch writes.
  - A press, or a key that neither scrolls nor types, takes it at once when there is none: the press that toggles a panel can come before the look after the rest. A key that types, a key that scrolls and any input in a view that follows its end take nothing. When every key took it, ten letters typed in the composer made 30 hit tests.
  - Taking it is one hit test (`elementsFromPoint` and `caretPositionFromPoint`) at the middle of the reading line, and two more only when no letter is there. A hit test reads layout. After a frame has rendered the layout is done, so the look forces none; in the task of a rest or of a size batch it forced one (9.7 ms in one of ten wheel notches).
  - It is taken only from a row whose height the list has applied (`applied`), and the refresh after a size batch waits for the same. A row that changed after it was last measured shows its content where the list has not put it yet. A reading from that layout made the batch that applies the change see no movement: under an older page, the reply the reader was in moved 8 px.
  - It is not a share of a row's height. A share is a guess at where a row changed. In a reply with 60 short code lines above prose, opening the review panel grew the row 897 px, all of it in the prose. A share moved the code line the reader was on 121 px; `dev` moved it 0 px.
- While the view rests where the reader scrolled it (`isRoaming` in `src/session/timeline/machine.ts`), is not at the start of the list, and what the reader is on is still where it was taken, it leads every row but one the reader pressed in:
  - A change in a row before its row moves the scroll offset. A change in a row after its row does not.
  - Its own row is resized in two steps, because TanStack compensates a resize in full or not at all: first by how far the new layout moved it inside the row, which moves the scroll offset, then by the rest.
  - This holds for a row that wraps again (a panel, a narrow window, another font, another setting), for a row whose content arrives late, and for a reply that streams: text added under the reader moves nothing.
- A row whose observed width changed (`wrapped`) is led the same way in every state. A view that follows then returns to its end.
- **A row the reader pressed in** (`acted`: from the click until the row is next resized with no marker in it) keeps its own top edge, so the control they pressed stays under the pointer and what it opens grows downward.
- When what the reader is on is not known (they are still scrolling, or its content was replaced):
  - A row the reader has seen keeps its own top edge: it is compensated only while it is above the fold (`isAboveFold`). That is what `dev` does.
  - A row the reader has not seen grows away from the rows that hold still: the rows in the scroll port that the reader has seen and that the same batch does not resize. With those all below it, it grows upward. With those all above it, it grows downward. With such rows on both sides, or with none, the reading line stands in: a row that starts above the line grows upward, and any other row grows downward. This is the rule of a wheel that is turning: the rows above fill in and the rows already read stay where the wheel put them.
- A row is settled once it is measured with no marker in it. The reader has seen a row (`familiar`) when it is settled and the ResizeObserver first reported its element in an earlier frame than the one being rendered. A row that mounts and is measured in the frame being rendered has not been shown yet, however many measurement batches that frame has.
- A row is measured before all of its content has rendered. A diff, Markdown from the worker, a diagram and a deferred body arrive later, and the row grows. In history the reader had not visited, that growth pushed the rows in view 600 to 1,800 px away from where the wheel had put them.
- Content that renders after its row mounts carries a marker until it has rendered. `pendingContent` lists the markers: `data-disclosure-pending`, a `[data-component="file"]` without `data-file-ready`, a `[data-component="markdown"]` without `data-markdown-ready`, and `data-mermaid-pending`. When you add content that renders late, give it a marker, add the marker to that list, and add its attribute to `pendingAttributes`.
- A marker must always clear, also when the render fails or times out. In four real sessions a marker stayed 20 to 140 ms at the median and 3 s at the longest (Markdown of a long reply), and none of 759 rows kept one. While a row has a marker:
  - It is not settled.
  - Under a reader who rests where they scrolled, it does not get shorter than the size the list has for it: a measurement below that size is dropped. A view that follows the end, holds a tool or is where navigation sent it applies every measurement: the batch that applies one is also what brings a view that follows back to its end. When the first measurement of a new row that still waited for its text was dropped there, the row kept the 60px the list gives a new row and the view was 60px from its end for one frame. The placeholder is not the row's height. Before, a row went from its 60px estimate to a 16px placeholder and then to its real height, and the first step pulled a reader near the top of the loaded history to the top, where the browser dropped the rest of their wheel.
  - When a marker attribute changes in a row that is not settled or that holds such room, the row is measured again on the next frame, so content that arrives without changing the row's height still settles it.
- A view that follows the end, holds a revealed tool call, or is where navigation sent it keeps the top edge rule until the reader scrolls on, and so does the start of the list: the place the reader asked for stays.
- The rule does not use the direction the reader last scrolled in. A reader who rests does not have one. When the rule used it, a patch that arrived under a reader who had nudged up 10 px to stop following moved the rows they were reading 3,840 px.
- TanStack folds each correction into the scroll offset it believes, and stops that offset at 0 (`applyScrollAdjustment`). Near the start of the list, rows that got shorter before others got taller in one batch ran into that stop, and the rows in view ended too high by what the stop took (61 px in one run). The batch therefore resizes the rows that grow first.
- The space above a reply row depends on the reply row before it. When an older page arrives, the first reply row under it changes height: by 8 to 32 px of space, or by the tools the page adds to a group. The rows from the page's edge down to that row stop being settled, so the change moves the scroll offset and not the rows under it.
- A revealed tool call lets go when the reader scrolls on by any input, also one the timeline does not see: the follow machine's `scroll` event says how far the reader moved, and the movement adds up with its sign. Holding the tool would pull the reader back at the next measurement.
- A layout can move the place where the list starts on the screen. Below 768 px a bar opens above the timeline (72 px) and the space above the first row gets shorter (64 px to 16 px), so every row moved 24 px on the screen. `keepOrigin` writes that distance into the scroll offset for a reader who rests where they scrolled; it runs when the viewport reports its size and at the start of a size batch. A view at the end, at the start or where navigation sent it keeps its place in the scroll port.
- Keepers:
  - `e2e/regression/timeline-geometry.spec.ts`: "keeps … a reader is on where it is when the review panel narrows the timeline" for a code line above prose, a code line under prose, a table row, a list item, a line of tool output, a line of a diff, an image under prose and a paragraph; "keeps the words a reader is on in place when another font lays the rows out again"; "keeps the words a reader is on where they are on the screen when the window narrows to the phone layout"; "does not look for what the reader is on while they type"; "looks for what the reader is on once for each rest after a scroll key"; "keeps the rows in view still while a file diff the reader scrolled up to renders"; "leaves the rows a reader rests on in place while a patch that arrives under them renders"; "keeps the start of the session in view after Home while its rows render".
  - `e2e/regression/timeline-history.spec.ts`: "keeps visible rows fixed while an older page that ends inside a turn prepends"; "keeps a tall reply a reader is in fixed while an older page that ends inside its turn prepends".
  - `e2e/regression/timeline-stream.spec.ts`: "stays at its end in every frame while new rows of a reply stream in".
  - `e2e/regression/session-queue.spec.ts`: "a steer leaves every row as tall as its content".
  - `e2e/regression/mobile-timeline-scroll.spec.ts`: "keeps the words on the reading line anchored through reflow and touch cancellation".
  - A keeper measures where words or rows are on the screen: a DOM Range around a marked word, or a row's box. `scrollTop` can stay put while a row in view moves, and a share of a row's height makes the assumption the old rule made.
- To check by hand: open a long session, scroll up through history you have not visited with fast wheel bursts, and stop. The rows you were reading must stay where the wheel left them while the rows above them fill in. Then put a line of a code block on the reading line and open and close the review panel, pick another UI font in a second window, and drag the window narrower than 768 px: that line must stay where it is.

### `:has()` selectors

- Chromium rechecks an element's `:has()` when focus moves, an attribute changes, or an element is added or removed near it. In and around the timeline, that happens many times a second during a scroll.
- When the selector ends at the `:has()` element (`x:has(…)`, `x:has(…)::after`), a recheck restyles that element only.
- When the selector continues (`x:has(…) y`, `x:has(…) ~ y`), a recheck restyles nearly every element inside `x`. Other rules decide how many: once any rule in the app ends in `[data-slot=…]` after a `:has()`, a recheck restyles every element inside `x` that has a `data-slot` attribute, whatever its value. Such rules exist, and almost every element has a `data-slot`.
- On an element that contains the timeline, a list, a panel or a page, end the selector at the `:has()` element. To style another element, set a `data-` attribute on that element from code.
- On a small component (a row, a tab, a card, a menu), the selector may continue after `:has()`. A recheck costs the size of that component.
- Never select on `style` inside `:has()`. Every inline style write then rechecks the `:has()` of the element's ancestors, and the virtualizer writes inline styles while the reader scrolls. Set a `data-` attribute when the element is built, and select on that.
- To check: record a Chrome trace of the `devtools.timeline` category while you scroll through history that has not been visited, click in the timeline and press a scroll key. Read `elementCount` on each `UpdateLayoutTree` event; DevTools shows it as Recalculate Style, Elements Affected. A pass that affects about as many elements as the timeline contains is this regression.

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
