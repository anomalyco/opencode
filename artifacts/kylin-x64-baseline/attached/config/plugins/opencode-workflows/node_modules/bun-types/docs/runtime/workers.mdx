---
title: Workers
description: Use Bun's Workers API to create and communicate with a new JavaScript instance running on a separate thread while sharing I/O resources with the main thread
---

<Warning>
  The `Worker` API is still experimental (particularly for terminating workers). We are actively working on improving
  this.
</Warning>

[`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker) lets you start and communicate with a new JavaScript instance running on a separate thread while sharing I/O resources with the main thread.

Bun implements a minimal version of the [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) with extensions that make it work better for server-side use cases. Like the rest of Bun, `Worker` in Bun support CommonJS, ES Modules, TypeScript, JSX, TSX and more out of the box. No extra build steps are necessary.

## Creating a `Worker`

Like in browsers, [`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker) is a global. Use it to create a new worker thread.

### From the main thread

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker("./worker.ts");

worker.postMessage("hello");
worker.onmessage = event => {
  console.log(event.data);
};
```

### Worker thread

```ts worker.ts icon="file-code"
// prevents TS errors
declare var self: Worker;

self.onmessage = (event: MessageEvent) => {
  console.log(event.data);
  postMessage("world");
};
```

To prevent TypeScript errors when using `self`, add this line to the top of your worker file.

```ts
declare var self: Worker;
```

You can use `import` and `export` syntax in your worker code. Unlike in browsers, there's no need to specify `{type: "module"}` to use ES Modules.

To simplify error handling, the initial script to load is resolved at the time `new Worker(url)` is called.

```js
const worker = new Worker("/not-found.js");
// throws an error immediately
```

The specifier passed to `Worker` is resolved relative to the project root (like typing `bun ./path/to/file.js`).

### `preload` - load modules before the worker starts

You can pass an array of module specifiers to the `preload` option to load modules before the worker starts. This is useful when you want to ensure some code is always loaded before the application starts, like loading OpenTelemetry, Sentry, DataDog, etc.

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker("./worker.ts", {
  preload: ["./load-sentry.js"],
});
```

Like the `--preload` CLI argument, the `preload` option is processed before the worker starts.

You can also pass a single string to the `preload` option:

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker("./worker.ts", {
  preload: "./load-sentry.js",
});
```

### `blob:` URLs

You can also pass a `blob:` URL to `Worker`. This is useful for creating workers from strings or other sources.

```js
const blob = new Blob([`self.onmessage = (event: MessageEvent) => postMessage(event.data)`], {
  type: "application/typescript",
});
const url = URL.createObjectURL(blob);
const worker = new Worker(url);
```

Like the rest of Bun, workers created from `blob:` URLs support TypeScript, JSX, and other file types out of the box. You can communicate it should be loaded via typescript either via `type` or by passing a `filename` to the `File` constructor.

```ts
const file = new File([`self.onmessage = (event: MessageEvent) => postMessage(event.data)`], "worker.ts");
const url = URL.createObjectURL(file);
const worker = new Worker(url);
```

### `"open"`

The `"open"` event is emitted when a worker is created and ready to receive messages. This can be used to send an initial message to a worker once it's ready. (This event does not exist in browsers.)

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker(new URL("worker.ts", import.meta.url).href);

worker.addEventListener("open", () => {
  console.log("worker is ready");
});
```

Messages are automatically enqueued until the worker is ready, so there is no need to wait for the `"open"` event to send messages.

## Messages with `postMessage`

To send messages, use [`worker.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage) and [`self.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage). This leverages the [HTML Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).

### Performance optimizations

Bun includes optimized fast paths for `postMessage` to dramatically improve performance for common data types:

**String fast path** - When posting pure string values, Bun bypasses the structured clone algorithm entirely, achieving significant performance gains with no serialization overhead.

**Simple object fast path** - For plain objects containing only primitive values (strings, numbers, booleans, null, undefined), Bun uses an optimized serialization path that stores properties directly without full structured cloning.

The simple object fast path activates when the object:

- Is a plain object with no prototype chain modifications
- Contains only enumerable, configurable data properties
- Has no indexed properties or getter/setter methods
- All property values are primitives or strings

With these fast paths, Bun's `postMessage` performs **2-241x faster** because the message length no longer has a meaningful impact on performance.

**Bun (with fast paths):**

```ts
postMessage({ prop: 11 chars string, ...9 more props }) - 648ns
postMessage({ prop: 14 KB string, ...9 more props })    - 719ns
postMessage({ prop: 3 MB string, ...9 more props })     - 1.26µs
```

**Node.js v24.6.0 (for comparison):**

```js
postMessage({ prop: 11 chars string, ...9 more props }) - 1.19µs
postMessage({ prop: 14 KB string, ...9 more props })    - 2.69µs
postMessage({ prop: 3 MB string, ...9 more props })     - 304µs
```

```js
// String fast path - optimized
postMessage("Hello, worker!");

// Simple object fast path - optimized
postMessage({
  message: "Hello",
  count: 42,
  enabled: true,
  data: null,
});

// Complex objects still work but use standard structured clone
postMessage({
  nested: { deep: { object: true } },
  date: new Date(),
  buffer: new ArrayBuffer(8),
});
```

```js
// On the worker thread, `postMessage` is automatically "routed" to the parent thread.
postMessage({ hello: "world" });

// On the main thread
worker.postMessage({ hello: "world" });
```

To receive messages, use the [`message` event handler](https://developer.mozilla.org/en-US/docs/Web/API/Worker/message_event) on the worker and main thread.

```js
// Worker thread:
self.addEventListener("message", event => {
  console.log(event.data);
});
// or use the setter:
// self.onmessage = fn

// if on the main thread
worker.addEventListener("message", event => {
  console.log(event.data);
});
// or use the setter:
// worker.onmessage = fn
```

## Terminating a worker

A `Worker` instance terminates automatically once it's event loop has no work left to do. Attaching a `"message"` listener on the global or any `MessagePort`s will keep the event loop alive. To forcefully terminate a `Worker`, call `worker.terminate()`.

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker(new URL("worker.ts", import.meta.url).href);

// ...some time later
worker.terminate();
```

This will cause the worker's to exit as soon as possible.

### `process.exit()`

A worker can terminate itself with `process.exit()`. This does not terminate the main process. Like in Node.js, `process.on('beforeExit', callback)` and `process.on('exit', callback)` are emitted on the worker thread (and not on the main thread), and the exit code is passed to the `"close"` event.

### `"close"`

The `"close"` event is emitted when a worker has been terminated. It can take some time for the worker to actually terminate, so this event is emitted when the worker has been marked as terminated. The `CloseEvent` will contain the exit code passed to `process.exit()`, or 0 if closed for other reasons.

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker(new URL("worker.ts", import.meta.url).href);

worker.addEventListener("close", event => {
  console.log("worker is being closed");
});
```

This event does not exist in browsers.

## Managing lifetime

By default, an active `Worker` will keep the main (spawning) process alive, so async tasks like `setTimeout` and promises will keep the process alive. Attaching `message` listeners will also keep the `Worker` alive.

### `worker.unref()`

To stop a running worker from keeping the process alive, call `worker.unref()`. This decouples the lifetime of the worker to the lifetime of the main process, and is equivalent to what Node.js' `worker_threads` does.

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker(new URL("worker.ts", import.meta.url).href);
worker.unref();
```

Note: `worker.unref()` is not available in browsers.

### `worker.ref()`

To keep the process alive until the `Worker` terminates, call `worker.ref()`. A ref'd worker is the default behavior, and still needs something going on in the event loop (such as a `"message"` listener) for the worker to continue running.

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker(new URL("worker.ts", import.meta.url).href);
worker.unref();
// later...
worker.ref();
```

Alternatively, you can also pass an `options` object to `Worker`:

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker(new URL("worker.ts", import.meta.url).href, {
  ref: false,
});
```

Note: `worker.ref()` is not available in browsers.

## Memory usage with `smol`

JavaScript instances can use a lot of memory. Bun's `Worker` supports a `smol` mode that reduces memory usage, at a cost of performance. To enable `smol` mode, pass `smol: true` to the `options` object in the `Worker` constructor.

```ts index.ts icon="/icons/typescript.svg"
const worker = new Worker("./i-am-smol.ts", {
  smol: true,
});
```

<Accordion title="What does `smol` mode actually do?">
  Setting `smol: true` sets `JSC::HeapSize` to be `Small` instead of the default `Large`.
</Accordion>

## Environment Data

Share data between the main thread and workers using `setEnvironmentData()` and `getEnvironmentData()`.

```ts title="index.ts" icon="/icons/typescript.svg"
import { setEnvironmentData, getEnvironmentData } from "worker_threads";

// In main thread
setEnvironmentData("config", { apiUrl: "https://api.example.com" });

// In worker
const config = getEnvironmentData("config");
console.log(config); // => { apiUrl: "https://api.example.com" }
```

## Worker Events

Listen for worker creation events using `process.emit()`:

```ts title="index.ts" icon="/icons/typescript.svg"
process.on("worker", worker => {
  console.log("New worker created:", worker.threadId);
});
```

## `Bun.isMainThread`

You can check if you're in the main thread by checking `Bun.isMainThread`.

```ts
if (Bun.isMainThread) {
  console.log("I'm the main thread");
} else {
  console.log("I'm in a worker");
}
```

This is useful for conditionally running code based on whether you're in the main thread or not.
