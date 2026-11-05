---
title: "Watch Mode"
description: "Automatic reloading in Bun with --watch and --hot modes"
---

Bun supports two kinds of automatic reloading via CLI flags:

- `--watch` mode, which hard restarts Bun's process when imported files change.
- `--hot` mode, which soft reloads the code (without restarting the process) when imported files change.

---

## `--watch` mode

Watch mode can be used with `bun test` or when running TypeScript, JSX, and JavaScript files.

To run a file in `--watch` mode:

```bash terminal icon="terminal"
bun --watch index.tsx
```

To run your tests in `--watch` mode:

```bash terminal icon="terminal"
bun --watch test
```

In `--watch` mode, Bun keeps track of all imported files and watches them for changes. When a change is detected, Bun restarts the process, preserving the same set of CLI arguments and environment variables used in the initial run. If Bun crashes, `--watch` will attempt to automatically restart the process.

<Note>

**⚡️ Reloads are fast.** The filesystem watchers you're probably used to have several layers of libraries wrapping the native APIs or worse, rely on polling.

Instead, Bun uses operating system native filesystem watcher APIs like kqueue or inotify to detect changes to files. Bun also applies several optimizations to scale to larger projects (such as setting a high rlimit for file descriptors, statically allocated file path buffers, reuse file descriptors when possible, etc).

</Note>

The following examples show Bun live-reloading a file as it is edited, with VSCode configured to save the file [on each keystroke](https://code.visualstudio.com/docs/editor/codebasics#_save-auto-save).

```sh terminal icon="terminal"
bun run --watch watchy.tsx
```

```tsx title="watchy.tsx" icon="/icons/typescript.svg"
import { serve } from "bun";

console.log("I restarted at:", Date.now());

serve({
  port: 4003,
  fetch(request) {
    return new Response("Sup");
  },
});
```

In this example, Bun is

<Frame>
  ![bun watch gif](https://user-images.githubusercontent.com/709451/228439002-7b9fad11-0db2-4e48-b82d-2b88c8625625.gif)
</Frame>

Running `bun test` in watch mode and `save-on-keypress` enabled:

```bash terminal icon="terminal"
bun --watch test
```

<Frame>
  ![bun test gif](https://user-images.githubusercontent.com/709451/228396976-38a23864-4a1d-4c96-87cc-04e5181bf459.gif)
</Frame>

<Note>
  The **`--no-clear-screen`** flag is useful in scenarios where you don't want the terminal to clear, such as when
  running multiple `bun build --watch` commands simultaneously using tools like `concurrently`. Without this flag, the
  output of one instance could clear the output of others, potentially hiding errors from one instance beneath the
  output of another. The `--no-clear-screen` flag, similar to TypeScript's `--preserveWatchOutput`, prevents this issue.
  It can be used in combination with `--watch`, for example: `bun build --watch --no-clear-screen`.
</Note>

---

## `--hot` mode

Use `bun --hot` to enable hot reloading when executing code with Bun. This is distinct from `--watch` mode in that Bun does not hard-restart the entire process. Instead, it detects code changes and updates its internal module cache with the new code.

<Note>
  This is not the same as hot reloading in the browser! Many frameworks provide a "hot reloading" experience, where you
  can edit & save your frontend code (say, a React component) and see the changes reflected in the browser without
  refreshing the page. Bun's `--hot` is the server-side equivalent of this experience. To get hot reloading in the
  browser, use a framework like [Vite](https://vite.dev).
</Note>

```bash terminal icon="terminal"
bun --hot server.ts
```

Starting from the entrypoint (`server.ts` in the example above), Bun builds a registry of all imported source files (excluding those in `node_modules`) and watches them for changes. When a change is detected, Bun performs a "soft reload". All files are re-evaluated, but all global state (notably, the `globalThis` object) is persisted.

```ts title="server.ts" icon="/icons/typescript.svg"
// make TypeScript happy
declare global {
  var count: number;
}

globalThis.count ??= 0;
console.log(`Reloaded ${globalThis.count} times`);
globalThis.count++;

// prevent `bun run` from exiting
setInterval(function () {}, 1000000);
```

If you run this file with `bun --hot server.ts`, you'll see the reload count increment every time you save the file.

```bash terminal icon="terminal"
bun --hot index.ts
```

```txt
Reloaded 1 times
Reloaded 2 times
Reloaded 3 times
```

Traditional file watchers like `nodemon` restart the entire process, so HTTP servers and other stateful objects are lost. By contrast, `bun --hot` is able to reflect the updated code without restarting the process.

### HTTP servers

This makes it possible, for instance, to update your HTTP request handler without shutting down the server itself. When you save the file, your HTTP server will be reloaded with the updated code without the process being restarted. This results in seriously fast refresh speeds.

```ts title="server.ts" icon="/icons/typescript.svg"
globalThis.count ??= 0;
globalThis.count++;

Bun.serve({
  fetch(req: Request) {
    return new Response(`Reloaded ${globalThis.count} times`);
  },
  port: 3000,
});
```

<Note>
**Note** — In a future version of Bun, support for Vite's `import.meta.hot` is planned to enable better lifecycle management for hot reloading and to align with the ecosystem.

</Note>

<Accordion title="Implementation details">

On hot reload, Bun:

- Resets the internal `require` cache and ES module registry (`Loader.registry`)
- Runs the garbage collector synchronously (to minimize memory leaks, at the cost of runtime performance)
- Re-transpiles all of your code from scratch (including sourcemaps)
- Re-evaluates the code with JavaScriptCore

This implementation isn't particularly optimized. It re-transpiles files that haven't changed. It makes no attempt at incremental compilation. It's a starting point.

</Accordion>
