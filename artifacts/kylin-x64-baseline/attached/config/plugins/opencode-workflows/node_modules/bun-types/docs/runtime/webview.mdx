---
title: WebView
description: Control a headless browser from Bun for automation, testing, and scraping — zero dependencies on macOS, Chrome DevTools Protocol everywhere else
---

`Bun.WebView` is a headless browser built into the runtime. Use it to load pages, run JavaScript inside them, simulate real user input, and capture screenshots — without Puppeteer, Playwright, or a separate browser download.

<Warning>This API is experimental and may change in future releases.</Warning>

```ts
await using view = new Bun.WebView();

await view.navigate("https://example.com");
await view.click("a[href]"); // waits for the link to be clickable
const title = await view.evaluate("document.title");

await Bun.write("page.png", await view.screenshot());
```

On macOS, `Bun.WebView` uses the system's `WKWebView` — nothing to install. On Linux and Windows it drives an installed Chrome, Chromium, Edge, or Brave over the Chrome DevTools Protocol.

Each view runs its page in a separate renderer process. All input methods (`click`, `type`, `press`, `scroll`) dispatch **native** browser events, so the page sees `isTrusted: true` — the same as a real user.

---

## Creating a view

```ts
const view = new Bun.WebView({
  width: 1280, // viewport width in CSS pixels (1-16384, default 800)
  height: 720, // viewport height in CSS pixels (1-16384, default 600)
  url: "https://bun.com", // optional: start navigating immediately
});
```

The constructor is synchronous — it returns immediately and spawns the browser subprocess in the background. The first operation you `await` (a `navigate()`, `evaluate()`, etc.) will wait for the browser to be ready.

If you pass `url`, the view begins navigating before the constructor returns. This is equivalent to calling `view.navigate(url)` on the next line.

### Automatic cleanup with `using`

`Bun.WebView` implements `Symbol.dispose` and `Symbol.asyncDispose`, so you can use `using` or `await using` to close the view automatically when it goes out of scope:

```ts
{
  await using view = new Bun.WebView();
  await view.navigate("https://example.com");
  // ...
} // view.close() called automatically here
```

### Persistent storage

By default, each view uses **ephemeral** in-memory storage — cookies, `localStorage`, IndexedDB, and cache are discarded when the view closes. To persist state across runs, pass a directory:

```ts
const view = new Bun.WebView({
  dataStore: { directory: "./browser-profile" },
});
```

Views that share the same `directory` share cookies and storage. Pass `dataStore: "ephemeral"` (the default) to opt back into in-memory storage explicitly.

<Note>
  With the Chrome backend, `dataStore.directory` maps to `--user-data-dir` and applies to the **entire Chrome process**,
  not per-view. Since Chrome is spawned once per Bun process, the first view's directory wins for all subsequent views.
</Note>

<Note>
  With the WebKit backend, persistent storage requires macOS 15.2+. On older macOS versions, use `dataStore:
  "ephemeral"` (the default).
</Note>

---

## Backends

`Bun.WebView` supports two rendering engines. The default depends on your platform:

| Backend    | Engine    | Platforms     | Requirements                                                                         |
| ---------- | --------- | ------------- | ------------------------------------------------------------------------------------ |
| `"webkit"` | WKWebView | macOS only    | None — uses the system `WebKit.framework`                                            |
| `"chrome"` | Blink     | macOS / Linux | Chrome, Chromium, Edge, or Brave installed (or Playwright's `chrome-headless-shell`) |

On macOS the default is `"webkit"`; elsewhere it's `"chrome"`. Requesting `backend: "webkit"` on a non-macOS platform throws.

```ts
// Force Chrome on macOS
const view = new Bun.WebView({ backend: "chrome" });
```

### How the WebKit backend works

Bun spawns a lightweight host subprocess (the `bun` binary itself, re-executed in a special mode) that owns the `WKWebView` on its main thread. Your Bun process talks to it over a Unix socket using a compact binary protocol. The host process is spawned once and shared by every `"webkit"` view in your program.

### How the Chrome backend works

Bun either **connects** to an already-running Chrome over a WebSocket, or **spawns** a headless Chrome subprocess and talks to it over a pipe (`--remote-debugging-pipe`). Either way, communication uses the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/).

Chrome is spawned (or connected) once per Bun process. Each `new Bun.WebView({ backend: "chrome" })` creates a new tab via `Target.createTarget` in that single Chrome instance.

#### Finding the Chrome executable

When Bun needs to spawn Chrome, it searches in this order:

1. The `path` you passed in `backend: { type: "chrome", path: "..." }`
2. The `BUN_CHROME_PATH` environment variable
3. `$PATH` (`google-chrome-stable`, `google-chrome`, `chromium-browser`, `chromium`, `brave-browser`, `microsoft-edge`, `chrome`)
4. Standard install locations (`/Applications/Google Chrome.app`, `~/Applications/...`, `/usr/bin/...`, `/snap/bin/...`, etc.)
5. Playwright's cache (`~/Library/Caches/ms-playwright` or `~/.cache/ms-playwright`) for `chrome-headless-shell`

If none is found, the constructor throws.

#### Connecting to an already-running Chrome {#existing-chrome}

By default, before spawning, Bun checks whether a Chrome-family browser is **already running** with remote debugging enabled by reading the `DevToolsActivePort` file from standard profile directories. If found, Bun connects to that browser over WebSocket instead of spawning a new one — your views open as tabs in your existing browser.

To enable remote debugging in a running Chrome, visit `chrome://inspect/#remote-debugging` and flip the toggle, or launch Chrome with `--remote-debugging-port=9222`. Chrome will prompt for permission on each new connection when using the `chrome://inspect` toggle.

To control this behavior explicitly, use the object form of `backend`:

```ts
// Always spawn a fresh headless Chrome; never auto-connect
new Bun.WebView({
  backend: { type: "chrome", url: false },
});

// Connect to a specific DevTools WebSocket URL
new Bun.WebView({
  backend: {
    type: "chrome",
    url: "ws://127.0.0.1:9222/devtools/browser/abc123...",
  },
});
```

If auto-detect finds a stale `DevToolsActivePort` file (Chrome crashed or restarted), the WebSocket connect fails and Bun transparently falls back to spawning its own Chrome. An explicit `url: "ws://..."` does **not** fall back — a failed connection throws.

<Note>
  Passing `path` or `argv` implies spawn mode and skips auto-detect. `url: "ws://..."` cannot be combined with `path` or
  `argv`.
</Note>

#### Launch flags

When spawning, Bun passes a minimal flag set:

```
--user-data-dir=<temp> --remote-debugging-pipe --headless --no-first-run
--no-default-browser-check --disable-gpu --disable-extensions
--disable-background-networking --disable-background-timer-throttling
--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
--disable-ipc-flooding-protection --no-startup-window
```

Append your own with `argv` — Chrome resolves duplicate switches last-wins, so you can override any default:

```ts
new Bun.WebView({
  backend: {
    type: "chrome",
    argv: ["--headless=new", "--lang=ja-JP", "--window-size=1920,1080"],
  },
});
```

#### Subprocess output

Browser subprocess stdout/stderr are silenced by default. Chrome in particular is noisy on stderr (font-config warnings, GCM registration, updater checks). To see it — useful when Chrome crashes silently — route it through:

```ts
new Bun.WebView({
  backend: { type: "chrome", stderr: "inherit", stdout: "inherit" },
});
```

The `"webkit"` backend accepts the same `stdout`/`stderr` options.

---

## Navigation

```ts
await view.navigate("https://example.com");
await view.navigate("data:text/html,<h1>hello</h1>");
await view.navigate("file:///path/to/index.html");
```

`navigate()` resolves when the main frame's `load` event fires. After it resolves, `view.url` and `view.title` reflect the new page, and `view.loading` is `false`.

If the navigation fails (DNS failure, connection refused, invalid URL), the promise rejects with an `Error` describing the failure.

Only one navigation may be in flight per view at a time. Calling `navigate()` while another is pending throws `ERR_INVALID_STATE` synchronously.

### History

```ts
await view.goBack(); // like the browser's back button
await view.goForward(); // like the browser's forward button
await view.reload(); // reload the current page
```

Calling `goBack()` at the beginning of history (or `goForward()` at the end) resolves `undefined` without navigating — it doesn't reject.

### Navigation callbacks

Set `onNavigated` and `onNavigationFailed` to observe every navigation, including ones triggered by the page itself (link clicks, `location.href = ...`, redirects) and by `reload()`/`goBack()`/`goForward()`:

```ts
view.onNavigated = (url, title) => {
  console.log("Loaded", url);
};

view.onNavigationFailed = error => {
  console.error("Navigation failed:", error.message);
};
```

These fire **before** the corresponding `navigate()` promise settles, so by the time `await view.navigate(...)` returns, your callback has already run. Set to `null` to remove.

---

## Evaluating JavaScript

Run an expression in the page's main frame and get its result back as a native JavaScript value:

```ts
const title = await view.evaluate("document.title");
const items = await view.evaluate("[...document.querySelectorAll('li')].map(li => li.textContent)");
const user = await view.evaluate("({ name: 'bun', ok: true })");
```

The script is wrapped as `await (<your script>)`, so:

- It must be an **expression**, not a statement sequence. For multiple statements, wrap in an IIFE: `evaluate("(() => { let x = foo(); return x + 1 })()")`.
- If it evaluates to a `Promise`, the promise is awaited and its resolved value is returned.

The result round-trips through `JSON.stringify` in the page and `JSON.parse` in Bun. Arrays and plain objects come back as real structures; `undefined`, functions, and symbols resolve to `undefined`; circular references reject.

```ts
await view.evaluate("42"); // 42
await view.evaluate("[1, 2, 3]"); // [1, 2, 3]
await view.evaluate("undefined"); // undefined
await view.evaluate("() => 1"); // undefined (functions don't serialize)
await view.evaluate("fetch('/api').then(r => r.json())"); // awaited
```

If the script throws (or returns a rejected promise), `evaluate()` rejects with an `Error` whose message comes from the page-side exception.

Only one `evaluate()` may be in flight per view at a time; a second concurrent call throws `ERR_INVALID_STATE`.

---

## Screenshots

Capture the current viewport as an image:

```ts
const png = await view.screenshot();
await Bun.write("page.png", png);
```

### Image format

```ts
await view.screenshot({ format: "png" }); // lossless (default)
await view.screenshot({ format: "jpeg", quality: 90 }); // lossy, quality 0-100 (default 80)
await view.screenshot({ format: "webp", quality: 75 }); // Chrome backend only
```

`quality` is ignored for PNG. `"webp"` is only available with `backend: "chrome"` — the WebKit backend throws.

### Return type

The `encoding` option controls how the image bytes are handed back:

| `encoding`           | Returns                          | Notes                                                                                                    |
| -------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `"blob"` _(default)_ | `Blob`                           | MIME type set automatically. Zero-copy mmap-backed on WebKit. Works with `Bun.write()`, `new Response()` |
| `"buffer"`           | `Buffer`                         | Node `Buffer`. Zero-copy mmap-backed on WebKit                                                           |
| `"base64"`           | `string`                         | Base64-encoded. Zero-decode on Chrome (CDP returns base64 natively)                                      |
| `"shmem"`            | `{ name: string, size: number }` | POSIX shared-memory segment name. Caller owns `shm_unlink`. Not supported on Windows                     |

```ts
const buf = await view.screenshot({ encoding: "buffer" });
console.log(buf[0] === 0x89); // PNG magic byte

const b64 = await view.screenshot({ encoding: "base64" });
console.log(`<img src="data:image/png;base64,${b64}">`);
```

#### Shared memory for terminal graphics

`encoding: "shmem"` is designed for Kitty's [terminal graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) `t=s` transmission mode — Bun writes the image to a POSIX shared-memory segment and returns its name; the terminal reads it directly and unlinks it when done. No copying through the pipe.

```ts
const { name, size } = await view.screenshot({ encoding: "shmem" });
process.stdout.write(`\x1b_Gf=100,t=s,a=T,S=${size};${btoa(name)}\x1b\\`);
// Kitty reads the PNG from shared memory and unlinks the segment
```

On WebKit, the shm name looks like `/bun-webview-<pid>-<seq>`; on Chrome, `/bun-chrome-<pid>-<seq>`. If you request `"shmem"` and don't hand the name to something that will `shm_unlink` it, the segment leaks until your process exits.

---

## Input simulation

All input methods dispatch **native** browser events. The page receives `pointerdown`/`mousedown`/`keydown`/`wheel` events with `isTrusted: true`, CSS `:active` and `:hover` states apply, and default actions (form submission, link navigation, text selection) fire exactly as if a user performed them.

### Clicking

Click at viewport coordinates:

```ts
await view.click(150, 200);
await view.click(150, 200, { button: "right" });
await view.click(150, 200, { clickCount: 2 }); // double-click
await view.click(150, 200, { modifiers: ["Shift", "Meta"] });
```

The promise resolves **after** the page has processed the full `mousedown` → `mouseup` → `click` sequence, including any JavaScript handlers. No polling needed — a subsequent `evaluate()` will see the result.

#### Clicking by selector

Pass a CSS selector instead of coordinates and Bun will wait for the element to become **actionable**, then click its center:

```ts
await view.click("#submit");
await view.click("button.primary", { timeout: 5000 });
```

An element is actionable when it:

- exists in the DOM
- has a non-zero bounding box
- is inside the viewport
- has been **stable** (bounding box unchanged) for two consecutive animation frames
- is the topmost element at its center point (not covered by an overlay)

The check runs page-side at `requestAnimationFrame` rate. If the element never becomes actionable within `timeout` milliseconds (default `30000`), the promise rejects with an error like `timeout waiting for '#submit' to be actionable`.

The selector is passed as data, not interpolated into a script, so selectors containing quotes or JavaScript syntax are safe.

### Typing text

Insert text into the currently focused element:

```ts
await view.click("input#email"); // focus it first
await view.type("hello@example.com");
```

`type()` uses the browser's `InsertText` editing command (the same path as paste), not per-character keystrokes. It fires `beforeinput`/`input` events with `isTrusted: true`, but **no `keydown`/`keyup` events**. There's no IME processing and no smart-quote substitution — the text lands exactly as given.

### Pressing keys

```ts
await view.press("Enter");
await view.press("Escape");
await view.press("ArrowDown");
await view.press("a", { modifiers: ["Meta"] }); // Cmd+A / Ctrl+A
```

Named virtual keys: `Enter`, `Tab`, `Space`, `Backspace`, `Delete`, `Escape`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `End`, `PageUp`, `PageDown`.

Any single character (e.g. `"a"`) combined with `modifiers` sends a keyboard chord.

On the WebKit backend, most named keys (without modifiers) map to editing commands (`DeleteBackward`, `MoveLeft`, `InsertNewline`, etc.) and resolve after the page has applied them. `Escape`, `Space`, and any key with modifiers fall back to raw `keydown`/`keyup` events — these fire a `keydown` the page can observe, but there's no completion barrier, so follow with an `evaluate()` if you need to observe the effect.

Modifier names: `"Shift"`, `"Control"` (or `"Ctrl"`), `"Alt"` (or `"Option"`), `"Meta"` (or `"Cmd"` / `"Command"`).

### Scrolling

Scroll by a pixel delta — fires a native `wheel` event at the viewport center:

```ts
await view.scroll(0, 500); // scroll down 500px
await view.scroll(-100, 0); // scroll left 100px
```

Positive `dy` scrolls down (content moves up), matching `window.scrollBy`. If a scrollable element sits under the viewport center, it receives the wheel event instead of the document.

Scroll an element into view by selector:

```ts
await view.scrollTo("#footer"); // center it (default)
await view.scrollTo("#hero", { block: "start" }); // align its top to the viewport top
await view.scrollTo(".card", { block: "nearest" }); // minimal scroll
```

`scrollTo()` waits (at `requestAnimationFrame` rate) for the element to exist, then calls `element.scrollIntoView({ block, behavior: "instant" })`. It scrolls every scrollable ancestor, not just the document. The default `timeout` is `30000` ms.

### Resizing

```ts
await view.resize(1920, 1080);
```

Width and height must each be between `1` and `16384`.

---

## Console capture

Forward `console.*` calls from the page to your Bun process by passing the `console` option to the constructor.

### Mirror to Bun's console

Pass `globalThis.console` (the actual object, by reference) and page-side `console.log("hi")` prints `hi` to your stdout with Bun's formatter; `console.error` goes to stderr. This path dispatches directly through Bun's console implementation with no per-call JavaScript overhead.

```ts
const view = new Bun.WebView({
  console: globalThis.console,
});
```

### Custom handler

Pass a function to receive each call yourself:

```ts
const view = new Bun.WebView({
  console: (type, ...args) => {
    // type is "log" | "warn" | "error" | "info" | "debug" | ...
    if (type === "error") reportError(args);
  },
});
```

Primitive arguments (strings, numbers, booleans, `null`, `undefined`) unwrap to their raw values. Object arguments arrive as a serialized descriptor:

- **Chrome backend**: the raw CDP [`RemoteObject`](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-RemoteObject) — an object with `type`, `className`, `description`, and (when available) a `preview.properties` array.
- **WebKit backend**: the `JSON.stringify` round-trip of the object. Functions, circular references, and other non-serializable values fall back to their `String(...)` coercion.

If you don't pass `console`, page-side console output is dropped.

<Note>
  Ordering guarantee: a `console.log(...)` inside a script you pass to `evaluate()` will deliver to your handler
  **before** that `evaluate()` resolves. Both travel over the same IPC connection.
</Note>

---

## Raw Chrome DevTools Protocol {#cdp}

When using `backend: "chrome"`, you can drop down to raw [CDP](https://chromedevtools.github.io/devtools-protocol/) commands for anything the high-level API doesn't cover.

### Sending commands

```ts
const view = new Bun.WebView({ backend: "chrome" });
await view.navigate("https://example.com"); // required: sets up the CDP session

await view.cdp("Emulation.setUserAgentOverride", {
  userAgent: "MyBot/1.0",
});

const { root } = await view.cdp("DOM.getDocument");
const { nodeId } = await view.cdp("DOM.querySelector", {
  nodeId: root.nodeId,
  selector: "input[name=q]",
});
await view.cdp("DOM.focus", { nodeId });
```

`cdp(method, params?)` returns the `result` object from the CDP response. If Chrome returns an error (unknown method, bad params), the promise rejects with its `error.message`.

Commands are scoped to this view's session (they target this tab). You must `await navigate(...)` at least once before calling `cdp()` — the first navigation establishes the session. Calling `cdp()` before that throws `ERR_INVALID_STATE`.

`params` must be a JSON-serializable object; omit it for commands that take no parameters. One `cdp()` call may be in flight at a time per view.

### Subscribing to events

`Bun.WebView` extends `EventTarget`. With the Chrome backend, CDP events are dispatched as DOM events whose `type` is the CDP method name and whose `data` is the parsed `params` object:

```ts
await view.navigate("about:blank");
await view.cdp("Network.enable"); // Chrome only emits events for enabled domains

view.addEventListener("Network.responseReceived", event => {
  console.log(event.data.response.status, event.data.response.url);
});

await view.navigate("https://example.com");
```

Events for which no listener is registered are dropped before the JSON `params` are even parsed, so enabling a chatty domain (like `Network`) is cheap if you only listen for one or two event types.

On the WebKit backend, `cdp()` throws `ERR_METHOD_NOT_IMPLEMENTED` — there is no DevTools Protocol bridge. The `EventTarget` interface still works for your own `dispatchEvent()` calls.

---

## Lifecycle

### Closing a view

```ts
view.close();
```

Closing is synchronous and idempotent. It destroys the page's renderer process, rejects any pending promises on the view with `Error("WebView closed")`, and makes every subsequent method call throw `ERR_INVALID_STATE`.

`view[Symbol.dispose]` and `view[Symbol.asyncDispose]` both point to `close()`, so `using` / `await using` work.

### Killing all browsers

```ts
Bun.WebView.closeAll();
```

Force-kills (`SIGKILL`) both the Chrome subprocess and the WebKit host subprocess. Pending promises on every view reject on the next event-loop tick. Subsequent `new Bun.WebView()` calls respawn as needed.

Bun calls this automatically at process exit, so browser subprocesses never outlive your script.

### Event-loop behavior

The browser subprocess does **not** keep Bun's event loop alive on its own. An open `WebView` keeps the process alive only while it has a pending operation (an unsettled `navigate()`, `evaluate()`, etc.). Once you `close()` the last view — or the last pending operation settles — Bun exits naturally.

### Subprocess death

If the browser subprocess dies unexpectedly (crash, OOM-kill, `SIGKILL`), every pending promise on every view rejects with an error describing how it died (`"Chrome killed by signal 9"`, `"WebView host process died"`, etc.), and further operations on those views throw.

---

## Concurrency model

Each view has a small number of independent operation "slots". One operation of each kind may be in flight at a time:

- one `navigate()` (shared with `reload()`/`goBack()`/`goForward()` on the Chrome backend)
- one `evaluate()`
- one `screenshot()`
- one `cdp()` (Chrome only)
- one "simple" operation — `click()`, `type()`, `press()`, `scroll()`, `scrollTo()`, `resize()` (and `reload()`/`goBack()`/`goForward()` on the WebKit backend) share this slot

Starting a second operation while its slot is occupied throws `ERR_INVALID_STATE` synchronously — it does **not** queue. In practice, just `await` each call.

Operations on **different views** are fully independent and run in parallel — each view has its own renderer process.

---

## Reference

### `new Bun.WebView(options?)`

| Option      | Type                                            | Default                                   | Description                                                                                    |
| ----------- | ----------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `width`     | `number`                                        | `800`                                     | Viewport width in CSS pixels. Range 1-16384.                                                   |
| `height`    | `number`                                        | `600`                                     | Viewport height in CSS pixels. Range 1-16384.                                                  |
| `url`       | `string`                                        | —                                         | Begin navigating to this URL immediately.                                                      |
| `headless`  | `boolean`                                       | `true`                                    | Only `true` is implemented; `false` throws.                                                    |
| `backend`   | `"webkit"` \| `"chrome"` \| [object](#backends) | `"webkit"` on macOS, `"chrome"` elsewhere | Rendering engine.                                                                              |
| `console`   | `typeof console` \| `(type, ...args) => void`   | —                                         | Capture page-side `console.*` calls. See [Console capture](#console-capture).                  |
| `dataStore` | `"ephemeral"` \| `{ directory: string }`        | `"ephemeral"`                             | Storage for cookies / localStorage / IndexedDB. See [Persistent storage](#persistent-storage). |

#### `backend` object form

| Option   | Type                      | Description                                                                                                                                            |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`   | `"chrome"` \| `"webkit"`  | **Required.** Which engine to use.                                                                                                                     |
| `path`   | `string`                  | (`chrome` only) Path to the Chrome/Chromium executable. Forces spawn mode.                                                                             |
| `argv`   | `string[]`                | (`chrome` only) Extra launch flags, appended after the defaults. Forces spawn mode.                                                                    |
| `url`    | `string` \| `false`       | (`chrome` only) `ws://` URL of an existing Chrome's DevTools endpoint, or `false` to skip auto-detect and always spawn. See [above](#existing-chrome). |
| `stdout` | `"inherit"` \| `"ignore"` | Route the subprocess's stdout to Bun's. Default `"ignore"`.                                                                                            |
| `stderr` | `"inherit"` \| `"ignore"` | Route the subprocess's stderr to Bun's. Default `"ignore"`.                                                                                            |

### Instance properties

| Property             | Type                                             | Description                                                                                 |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `url`                | `string` _(readonly)_                            | The current URL. Updated when a navigation completes. Empty string before first navigation. |
| `title`              | `string` _(readonly)_                            | The page's `<title>`. Updated when a navigation completes.                                  |
| `loading`            | `boolean` _(readonly)_                           | `true` while a navigation is in flight.                                                     |
| `onNavigated`        | `((url: string, title: string) => void) \| null` | Fires after each successful navigation, before the `navigate()` promise resolves.           |
| `onNavigationFailed` | `((error: Error) => void) \| null`               | Fires after each failed navigation, before the `navigate()` promise rejects.                |

### Instance methods

| Method                         | Returns                                             | Description                                                                                                     |
| ------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `navigate(url)`                | `Promise<void>`                                     | Load a URL. Resolves on the main frame's `load` event.                                                          |
| `evaluate(script)`             | `Promise<unknown>`                                  | Run a JS expression in the page and return its JSON-serialized result.                                          |
| `screenshot(options?)`         | `Promise<Blob \| Buffer \| string \| {name, size}>` | Capture the viewport. See [Screenshots](#screenshots).                                                          |
| `click(x, y, options?)`        | `Promise<void>`                                     | Native click at viewport coordinates.                                                                           |
| `click(selector, options?)`    | `Promise<void>`                                     | Wait for the element to be actionable, then click its center.                                                   |
| `type(text)`                   | `Promise<void>`                                     | Insert text into the focused element via the `InsertText` editing command.                                      |
| `press(key, options?)`         | `Promise<void>`                                     | Press a named virtual key or single-character chord.                                                            |
| `scroll(dx, dy)`               | `Promise<void>`                                     | Fire a native `wheel` event at the viewport center. `dx`/`dy` must be finite.                                   |
| `scrollTo(selector, options?)` | `Promise<void>`                                     | Wait for the element to exist, then `scrollIntoView`.                                                           |
| `resize(width, height)`        | `Promise<void>`                                     | Change the viewport size. Each dimension 1-16384.                                                               |
| `goBack()`                     | `Promise<void>`                                     | Navigate back in session history. No-op at the start.                                                           |
| `goForward()`                  | `Promise<void>`                                     | Navigate forward in session history. No-op at the end.                                                          |
| `reload()`                     | `Promise<void>`                                     | Reload the current page.                                                                                        |
| `cdp(method, params?)`         | `Promise<unknown>`                                  | (Chrome only) Send a raw CDP command scoped to this tab. See [Raw CDP](#cdp).                                   |
| `addEventListener(type, fn)`   | `void`                                              | Inherited from `EventTarget`. With Chrome, `type` may be a CDP event name; `event.data` is the parsed `params`. |
| `close()`                      | `void`                                              | Destroy the page. Rejects pending promises. Idempotent.                                                         |

#### `click()` options

| Option       | Type                                          | Default  | Description                                                          |
| ------------ | --------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `button`     | `"left"` \| `"right"` \| `"middle"`           | `"left"` | Mouse button.                                                        |
| `modifiers`  | `("Shift" \| "Control" \| "Alt" \| "Meta")[]` | `[]`     | Modifier keys held during the click.                                 |
| `clickCount` | `1` \| `2` \| `3`                             | `1`      | Click count for double/triple-click.                                 |
| `timeout`    | `number`                                      | `30000`  | (Selector overload only) Max milliseconds to wait for actionability. |

#### `press()` options

| Option      | Type                                          | Default | Description                             |
| ----------- | --------------------------------------------- | ------- | --------------------------------------- |
| `modifiers` | `("Shift" \| "Control" \| "Alt" \| "Meta")[]` | `[]`    | Modifier keys held during the keypress. |

#### `scrollTo()` options

| Option    | Type                                              | Default    | Description                                        |
| --------- | ------------------------------------------------- | ---------- | -------------------------------------------------- |
| `block`   | `"start"` \| `"center"` \| `"end"` \| `"nearest"` | `"center"` | Vertical alignment after scrolling.                |
| `timeout` | `number`                                          | `30000`    | Max milliseconds to wait for the element to exist. |

#### `screenshot()` options

| Option     | Type                                              | Default  | Description                                               |
| ---------- | ------------------------------------------------- | -------- | --------------------------------------------------------- |
| `format`   | `"png"` \| `"jpeg"` \| `"webp"`                   | `"png"`  | Image format. `"webp"` requires the Chrome backend.       |
| `quality`  | `number`                                          | `80`     | 0-100. JPEG/WebP only; ignored for PNG.                   |
| `encoding` | `"blob"` \| `"buffer"` \| `"base64"` \| `"shmem"` | `"blob"` | Return-type encoding. `"shmem"` not supported on Windows. |

### Static methods

| Method               | Description                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `WebView.closeAll()` | `SIGKILL` every browser subprocess. Pending promises reject on the next tick. Called automatically at exit. |
