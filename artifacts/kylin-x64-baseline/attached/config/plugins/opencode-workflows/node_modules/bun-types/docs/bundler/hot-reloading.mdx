---
title: Hot reloading
description: Hot Module Replacement (HMR) for Bun's development server
---

Hot Module Replacement (HMR) allows you to update modules in a running application without needing a full page reload. This preserves the application state and improves the development experience.

<Note>HMR is enabled by default when using Bun's full-stack development server.</Note>

## `import.meta.hot` API Reference

Bun implements a client-side HMR API modeled after [Vite's `import.meta.hot` API](https://vite.dev/guide/api-hmr). It can be checked for with `if (import.meta.hot)`, tree-shaking it in production.

```ts title="index.ts" icon="/icons/typescript.svg"
if (import.meta.hot) {
  // HMR APIs are available.
}
```

However, this check is often not needed as Bun will dead-code-eliminate calls to all of the HMR APIs in production builds.

```ts title="index.ts" icon="/icons/typescript.svg"
// This entire function call will be removed in production!
import.meta.hot.dispose(() => {
  console.log("dispose");
});
```

<Warning>
For this to work, Bun forces these APIs to be called without indirection. That means the following do not work:

```ts title="index.ts" icon="/icons/typescript.svg"
// INVALID: Assigning `hot` to a variable
const hot = import.meta.hot;
hot.accept();

// INVALID: Assigning `import.meta` to a variable
const meta = import.meta;
meta.hot.accept();
console.log(meta.hot.data);

// INVALID: Passing to a function
doSomething(import.meta.hot.dispose);

// OK: The full phrase "import.meta.hot.<API>" must be called directly:
import.meta.hot.accept();

// OK: `data` can be passed to functions:
doSomething(import.meta.hot.data);
```

</Warning>

<Note>
The HMR API is still a work in progress. Some features are missing. HMR can be disabled in `Bun.serve` by setting the development option to `{ hmr: false }`.
</Note>

## API Methods

| Method             | Status | Notes                                                                 |
| ------------------ | ------ | --------------------------------------------------------------------- |
| `hot.accept()`     | ✅     | Indicate that a hot update can be replaced gracefully.                |
| `hot.data`         | ✅     | Persist data between module evaluations.                              |
| `hot.dispose()`    | ✅     | Add a callback function to run when a module is about to be replaced. |
| `hot.invalidate()` | ❌     |                                                                       |
| `hot.on()`         | ✅     | Attach an event listener                                              |
| `hot.off()`        | ✅     | Remove an event listener from `on`.                                   |
| `hot.send()`       | ❌     |                                                                       |
| `hot.prune()`      | 🚧     | NOTE: Callback is currently never called.                             |
| `hot.decline()`    | ✅     | No-op to match Vite's `import.meta.hot`                               |

## import.meta.hot.accept()

The `accept()` method indicates that a module can be hot-replaced. When called without arguments, it indicates that this module can be replaced by re-evaluating the file. After a hot update, importers of this module will be automatically patched.

```ts title="index.ts" icon="/icons/typescript.svg"
// index.ts
import { getCount } from "./foo.ts";

console.log("count is ", getCount());

import.meta.hot.accept();

export function getNegativeCount() {
  return -getCount();
}
```

This creates a hot-reloading boundary for all of the files that `index.ts` imports. That means whenever `foo.ts` or any of its dependencies are saved, the update will bubble up to `index.ts` will re-evaluate. Files that import `index.ts` will then be patched to import the new version of `getNegativeCount()`. If only `index.ts` is updated, only the one file will be re-evaluated, and the counter in `foo.ts` is reused.

This may be used in combination with `import.meta.hot.data` to transfer state from the previous module to the new one.

<Info>
  When no modules call `import.meta.hot.accept()` (and there isn't React Fast Refresh or a plugin calling it for you),
  the page will reload when the file updates, and a console warning shows which files were invalidated. This warning is
  safe to ignore if it makes more sense to rely on full page reloads.
</Info>

### With callback

When provided one callback, `import.meta.hot.accept` will function how it does in Vite. Instead of patching the importers of this module, it will call the callback with the new module.

```ts title="index.ts" icon="/icons/typescript.svg"
export const count = 0;

import.meta.hot.accept(newModule => {
  if (newModule) {
    // newModule is undefined when SyntaxError happened
    console.log("updated: count is now ", newModule.count);
  }
});
```

<Tip>
  Prefer using `import.meta.hot.accept()` without an argument as it usually makes your code easier to understand.
</Tip>

### Accepting other modules

```ts title="index.ts" icon="/icons/typescript.svg"
import { count } from "./foo";

import.meta.hot.accept("./foo", () => {
  if (!newModule) return;

  console.log("updated: count is now ", count);
});
```

Indicates that a dependency's module can be accepted. When the dependency is updated, the callback will be called with the new module.

### With multiple dependencies

```ts title="index.ts" icon="/icons/typescript.svg"
import.meta.hot.accept(["./foo", "./bar"], newModules => {
  // newModules is an array where each item corresponds to the updated module
  // or undefined if that module had a syntax error
});
```

Indicates that multiple dependencies' modules can be accepted. This variant accepts an array of dependencies, where the callback will receive the updated modules, and `undefined` for any that had errors.

## import.meta.hot.data

`import.meta.hot.data` maintains state between module instances during hot replacement, enabling data transfer from previous to new versions. When `import.meta.hot.data` is written into, Bun will also mark this module as capable of self-accepting (equivalent of calling `import.meta.hot.accept()`).

```tsx title="index.tsx" icon="/icons/typescript.svg"
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = (import.meta.hot.data.root ??= createRoot(elem));
root.render(<App />); // re-use an existing root
```

In production, `data` is inlined to be `{}`, meaning it cannot be used as a state holder.

<Tip>
  The above pattern is recommended for stateful modules because Bun knows it can minify `{}.prop ??= value` into `value`
  in production.
</Tip>

## import.meta.hot.dispose()

Attaches an on-dispose callback. This is called:

- Just before the module is replaced with another copy (before the next is loaded)
- After the module is detached (removing all imports to this module, see `import.meta.hot.prune()`)

```ts title="index.ts" icon="/icons/typescript.svg"
const sideEffect = setupSideEffect();

import.meta.hot.dispose(() => {
  sideEffect.cleanup();
});
```

<Warning>This callback is not called on route navigation or when the browser tab closes.</Warning>

Returning a promise will delay module replacement until the module is disposed. All dispose callbacks are called in parallel.

## import.meta.hot.prune()

Attaches an on-prune callback. This is called when all imports to this module are removed, but the module was previously loaded.

This can be used to clean up resources that were created when the module was loaded. Unlike `import.meta.hot.dispose()`, this pairs much better with `accept` and `data` to manage stateful resources. A full example managing a WebSocket:

```ts title="index.ts" icon="/icons/typescript.svg"
import { something } from "./something";

// Initialize or re-use a WebSocket connection
export const ws = (import.meta.hot.data.ws ??= new WebSocket(location.origin));

// If the module's import is removed, clean up the WebSocket connection.
import.meta.hot.prune(() => {
  ws.close();
});
```

<Info>
  If `dispose` was used instead, the WebSocket would close and re-open on every hot update. Both versions of the code
  will prevent page reloads when imported files are updated.
</Info>

## import.meta.hot.on() and off()

`on()` and `off()` are used to listen for events from the HMR runtime. Event names are prefixed with a prefix so that plugins do not conflict with each other.

```ts title="index.ts" icon="/icons/typescript.svg"
import.meta.hot.on("bun:beforeUpdate", () => {
  console.log("before a hot update");
});
```

When a file is replaced, all of its event listeners are automatically removed.

### Built-in events

| Event                  | Emitted when                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `bun:beforeUpdate`     | before a hot update is applied.                                                                 |
| `bun:afterUpdate`      | after a hot update is applied.                                                                  |
| `bun:beforeFullReload` | before a full page reload happens.                                                              |
| `bun:beforePrune`      | before prune callbacks are called.                                                              |
| `bun:invalidate`       | when a module is invalidated with `import.meta.hot.invalidate()`                                |
| `bun:error`            | when a build or runtime error occurs                                                            |
| `bun:ws:disconnect`    | when the HMR WebSocket connection is lost. This can indicate the development server is offline. |
| `bun:ws:connect`       | when the HMR WebSocket connects or re-connects.                                                 |

<Note>For compatibility with Vite, the above events are also available via `vite:*` prefix instead of `bun:*`.</Note>
