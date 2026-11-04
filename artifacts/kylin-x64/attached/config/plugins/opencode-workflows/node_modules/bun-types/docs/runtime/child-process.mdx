---
title: Spawn
description: Spawn child processes with `Bun.spawn` or `Bun.spawnSync`
---

## Spawn a process (`Bun.spawn()`)

Provide a command as an array of strings. The result of `Bun.spawn()` is a `Bun.Subprocess` object.

```ts
const proc = Bun.spawn(["bun", "--version"]);
console.log(await proc.exited); // 0
```

The second argument to `Bun.spawn` is a parameters object that can be used to configure the subprocess.

```ts
const proc = Bun.spawn(["bun", "--version"], {
  cwd: "./path/to/subdir", // specify a working directory
  env: { ...process.env, FOO: "bar" }, // specify environment variables
  onExit(proc, exitCode, signalCode, error) {
    // exit handler
  },
});

proc.pid; // process ID of subprocess
```

## Input stream

By default, the input stream of the subprocess is undefined; it can be configured with the `stdin` parameter.

```ts
const proc = Bun.spawn(["cat"], {
  stdin: await fetch("https://raw.githubusercontent.com/oven-sh/bun/main/examples/hashing.js"),
});

const text = await proc.stdout.text();
console.log(text); // "const input = "hello world".repeat(400); ..."
```

| Value                    | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `null`                   | **Default.** Provide no input to the subprocess  |
| `"pipe"`                 | Return a `FileSink` for fast incremental writing |
| `"inherit"`              | Inherit the `stdin` of the parent process        |
| `Bun.file()`             | Read from the specified file                     |
| `TypedArray \| DataView` | Use a binary buffer as input                     |
| `Response`               | Use the response `body` as input                 |
| `Request`                | Use the request `body` as input                  |
| `ReadableStream`         | Use a readable stream as input                   |
| `Blob`                   | Use a blob as input                              |
| `number`                 | Read from the file with a given file descriptor  |

The `"pipe"` option lets incrementally write to the subprocess's input stream from the parent process.

```ts
const proc = Bun.spawn(["cat"], {
  stdin: "pipe", // return a FileSink for writing
});

// enqueue string data
proc.stdin.write("hello");

// enqueue binary data
const enc = new TextEncoder();
proc.stdin.write(enc.encode(" world!"));

// send buffered data
proc.stdin.flush();

// close the input stream
proc.stdin.end();
```

Passing a `ReadableStream` to `stdin` lets you pipe data from a JavaScript `ReadableStream` directly to the subprocess's input:

```ts
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue("Hello from ");
    controller.enqueue("ReadableStream!");
    controller.close();
  },
});

const proc = Bun.spawn(["cat"], {
  stdin: stream,
  stdout: "pipe",
});

const output = await proc.stdout.text();
console.log(output); // "Hello from ReadableStream!"
```

## Output streams

You can read results from the subprocess via the `stdout` and `stderr` properties. By default these are instances of `ReadableStream`.

```ts
const proc = Bun.spawn(["bun", "--version"]);
const text = await proc.stdout.text();
console.log(text); // => "1.3.3\n"
```

Configure the output stream by passing one of the following values to `stdout/stderr`:

| Value        | Description                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `"pipe"`     | **Default for `stdout`.** Pipe the output to a `ReadableStream` on the returned `Subprocess` object |
| `"inherit"`  | **Default for `stderr`.** Inherit from the parent process                                           |
| `"ignore"`   | Discard the output                                                                                  |
| `Bun.file()` | Write to the specified file                                                                         |
| `number`     | Write to the file with the given file descriptor                                                    |

## Exit handling

Use the `onExit` callback to listen for the process exiting or being killed.

```ts index.ts icon="/icons/typescript.svg"
const proc = Bun.spawn(["bun", "--version"], {
  onExit(proc, exitCode, signalCode, error) {
    // exit handler
  },
});
```

For convenience, the `exited` property is a `Promise` that resolves when the process exits.

```ts index.ts icon="/icons/typescript.svg"
const proc = Bun.spawn(["bun", "--version"]);

await proc.exited; // resolves when process exit
proc.killed; // boolean — was the process killed?
proc.exitCode; // null | number
proc.signalCode; // null | "SIGABRT" | "SIGALRM" | ...
```

To kill a process:

```ts index.ts icon="/icons/typescript.svg"
const proc = Bun.spawn(["bun", "--version"]);
proc.kill();
proc.killed; // true

proc.kill(15); // specify a signal code
proc.kill("SIGTERM"); // specify a signal name
```

The parent `bun` process will not terminate until all child processes have exited. Use `proc.unref()` to detach the child process from the parent.

```ts index.ts icon="/icons/typescript.svg"
const proc = Bun.spawn(["bun", "--version"]);
proc.unref();
```

## Resource usage

You can get information about the process's resource usage after it has exited:

```ts index.ts icon="/icons/typescript.svg"
const proc = Bun.spawn(["bun", "--version"]);
await proc.exited;

const usage = proc.resourceUsage();
console.log(`Max memory used: ${usage.maxRSS} bytes`);
console.log(`CPU time (user): ${usage.cpuTime.user} µs`);
console.log(`CPU time (system): ${usage.cpuTime.system} µs`);
```

## Using AbortSignal

You can abort a subprocess using an `AbortSignal`:

```ts index.ts icon="/icons/typescript.svg"
const controller = new AbortController();
const { signal } = controller;

const proc = Bun.spawn({
  cmd: ["sleep", "100"],
  signal,
});

// Later, to abort the process:
controller.abort();
```

## Using timeout and killSignal

You can set a timeout for a subprocess to automatically terminate after a specific duration:

```ts index.ts icon="/icons/typescript.svg"
// Kill the process after 5 seconds
const proc = Bun.spawn({
  cmd: ["sleep", "10"],
  timeout: 5000, // 5 seconds in milliseconds
});

await proc.exited; // Will resolve after 5 seconds
```

By default, timed-out processes are killed with the `SIGTERM` signal. You can specify a different signal with the `killSignal` option:

```ts index.ts icon="/icons/typescript.svg"
// Kill the process with SIGKILL after 5 seconds
const proc = Bun.spawn({
  cmd: ["sleep", "10"],
  timeout: 5000,
  killSignal: "SIGKILL", // Can be string name or signal number
});
```

The `killSignal` option also controls which signal is sent when an AbortSignal is aborted.

## Using maxBuffer

For spawnSync, you can limit the maximum number of bytes of output before the process is killed:

```ts index.ts icon="/icons/typescript.svg"
// Kill 'yes' after it emits over 100 bytes of output
const result = Bun.spawnSync({
  cmd: ["yes"], // or ["bun", "exec", "yes"] on Windows
  maxBuffer: 100,
});
// process exits
```

## Inter-process communication (IPC)

Bun supports direct inter-process communication channel between two `bun` processes. To receive messages from a spawned Bun subprocess, specify an `ipc` handler.

```ts parent.ts icon="/icons/typescript.svg"
const child = Bun.spawn(["bun", "child.ts"], {
  ipc(message) {
    /**
     * The message received from the sub process
     **/
  },
});
```

The parent process can send messages to the subprocess using the `.send()` method on the returned `Subprocess` instance. A reference to the sending subprocess is also available as the second argument in the `ipc` handler.

```ts parent.ts icon="/icons/typescript.svg"
const childProc = Bun.spawn(["bun", "child.ts"], {
  ipc(message, childProc) {
    /**
     * The message received from the sub process
     **/
    childProc.send("Respond to child");
  },
});

childProc.send("I am your father"); // The parent can send messages to the child as well
```

Meanwhile the child process can send messages to its parent using with `process.send()` and receive messages with `process.on("message")`. This is the same API used for `child_process.fork()` in Node.js.

```ts child.ts
process.send("Hello from child as string");
process.send({ message: "Hello from child as object" });

process.on("message", message => {
  // print message from parent
  console.log(message);
});
```

```ts child.ts
// send a string
process.send("Hello from child as string");

// send an object
process.send({ message: "Hello from child as object" });
```

The `serialization` option controls the underlying communication format between the two processes:

- `advanced`: (default) Messages are serialized using the JSC `serialize` API, which supports cloning [everything `structuredClone` supports](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm). This does not support transferring ownership of objects.
- `json`: Messages are serialized using `JSON.stringify` and `JSON.parse`, which does not support as many object types as `advanced` does.

To disconnect the IPC channel from the parent process, call:

```ts
childProc.disconnect();
```

### IPC between Bun & Node.js

To use IPC between a `bun` process and a Node.js process, set `serialization: "json"` in `Bun.spawn`. This is because Node.js and Bun use different JavaScript engines with different object serialization formats.

```js bun-node-ipc.js icon="file-code"
if (typeof Bun !== "undefined") {
  const prefix = `[bun ${process.versions.bun} 🐇]`;
  const node = Bun.spawn({
    cmd: ["node", __filename],
    ipc({ message }) {
      console.log(message);
      node.send({ message: `${prefix} 👋 hey node` });
      node.kill();
    },
    stdio: ["inherit", "inherit", "inherit"],
    serialization: "json",
  });

  node.send({ message: `${prefix} 👋 hey node` });
} else {
  const prefix = `[node ${process.version}]`;
  process.on("message", ({ message }) => {
    console.log(message);
    process.send({ message: `${prefix} 👋 hey bun` });
  });
}
```

---

## Terminal (PTY) support

For interactive terminal applications, you can spawn a subprocess with a pseudo-terminal (PTY) attached using the `terminal` option. This makes the subprocess think it's running in a real terminal, enabling features like colored output, cursor movement, and interactive prompts.

```ts
const proc = Bun.spawn(["bash"], {
  terminal: {
    cols: 80,
    rows: 24,
    data(terminal, data) {
      // Called when data is received from the terminal
      process.stdout.write(data);
    },
  },
});

// Write to the terminal
proc.terminal.write("echo hello\n");

// Wait for the process to exit
await proc.exited;

// Close the terminal
proc.terminal.close();
```

When the `terminal` option is provided:

- The subprocess sees `process.stdout.isTTY` as `true`
- `stdin`, `stdout`, and `stderr` are all connected to the terminal
- `proc.stdin`, `proc.stdout`, and `proc.stderr` return `null` — use the terminal instead
- Access the terminal via `proc.terminal`

### Terminal options

| Option  | Description                                                                                                                                                        | Default            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `cols`  | Number of columns                                                                                                                                                  | `80`               |
| `rows`  | Number of rows                                                                                                                                                     | `24`               |
| `name`  | Terminal type for PTY configuration (set `TERM` env var separately via `env` option)                                                                               | `"xterm-256color"` |
| `data`  | Callback when data is received `(terminal, data) => void`                                                                                                          | —                  |
| `exit`  | Callback when PTY stream closes (EOF or error). `exitCode` is PTY lifecycle status (0=EOF, 1=error), not subprocess exit code. Use `proc.exited` for process exit. | —                  |
| `drain` | Callback when ready for more data `(terminal) => void`                                                                                                             | —                  |

### Terminal methods

The `Terminal` object returned by `proc.terminal` has the following methods:

```ts
// Write data to the terminal
proc.terminal.write("echo hello\n");

// Resize the terminal
proc.terminal.resize(120, 40);

// Set raw mode (disable line buffering and echo)
proc.terminal.setRawMode(true);

// Keep event loop alive while terminal is open
proc.terminal.ref();
proc.terminal.unref();

// Close the terminal
proc.terminal.close();
```

### Reusable Terminal

You can create a terminal independently and reuse it across multiple subprocesses:

```ts
await using terminal = new Bun.Terminal({
  cols: 80,
  rows: 24,
  data(term, data) {
    process.stdout.write(data);
  },
});

// Spawn first process
const proc1 = Bun.spawn(["echo", "first"], { terminal });
await proc1.exited;

// Reuse terminal for another process
const proc2 = Bun.spawn(["echo", "second"], { terminal });
await proc2.exited;

// Terminal is closed automatically by `await using`
```

When passing an existing `Terminal` object:

- The terminal can be reused across multiple spawns
- You control when to close the terminal
- The `exit` callback fires when you call `terminal.close()`, not when each subprocess exits
- Use `proc.exited` to detect individual subprocess exits

This is useful for running multiple commands in sequence through the same terminal session.

### Platform differences

`Bun.Terminal` uses `openpty()` on Linux and macOS, and ConPTY (`CreatePseudoConsole`) on Windows. The core behaviour — child sees a TTY, `write()` reaches the child's stdin, child output reaches the `data` callback, `resize()` updates the child's view — is the same on every platform. A few details differ:

- **No termios on Windows.** `inputFlags`, `outputFlags`, `localFlags`, and `controlFlags` always read as `0` and setting them is a no-op. `setRawMode()` records the flag but has no effect on the child; the child controls its own console mode.
- **No echo without a child process on Windows.** On POSIX, the kernel line discipline echoes `write()` input back to the `data` callback even with no process attached. ConPTY has no line discipline; input is buffered for the next reader. If you need echo, spawn a process that echoes.
- **ConPTY re-encodes output.** ConPTY renders the child's output to a virtual screen and emits whatever VT sequences describe the result, so the `data` callback receives semantically equivalent — but not byte-identical — escape sequences. Colours and text are preserved; cursor-positioning and reset sequences may be reordered or coalesced. ConPTY also emits a short VT init sequence (`\x1b[?9001h\x1b[?1004h…`) before any child output.
- **Input `\r` is not translated to `\n` on Windows.** POSIX `ICRNL` maps carriage return to newline on input; ConPTY passes `\r` through unchanged.
- **`process.on('SIGWINCH')` in the child does not fire under ConPTY** unless the child is reading stdin in raw mode. `process.stdout.columns`/`rows` do update after `resize()`. This is a libuv limitation that affects any libuv-based child (Node.js included).
- On Windows before 11 24H2 (build 26100), `terminal.close()` may not terminate a still-running child promptly because [`ClosePseudoConsole`](https://learn.microsoft.com/en-us/windows/console/closepseudoconsole) blocks until conhost has flushed its output through the pipe on those versions. Kill the attached process first if you need to tear down with a running child.

---

## Blocking API (`Bun.spawnSync()`)

Bun provides a synchronous equivalent of `Bun.spawn` called `Bun.spawnSync`. This is a blocking API that supports the same inputs and parameters as `Bun.spawn`. It returns a `SyncSubprocess` object, which differs from `Subprocess` in a few ways.

1. It contains a `success` property that indicates whether the process exited with a zero exit code.
2. The `stdout` and `stderr` properties are instances of `Buffer` instead of `ReadableStream`.
3. There is no `stdin` property. Use `Bun.spawn` to incrementally write to the subprocess's input stream.

```ts
const proc = Bun.spawnSync(["echo", "hello"]);

console.log(proc.stdout.toString());
// => "hello\n"
```

As a rule of thumb, the asynchronous `Bun.spawn` API is better for HTTP servers and apps, and `Bun.spawnSync` is better for building command-line tools.

---

## Benchmarks

<Note>
  ⚡️ Under the hood, `Bun.spawn` and `Bun.spawnSync` use
  [`posix_spawn(3)`](https://man7.org/linux/man-pages/man3/posix_spawn.3.html).
</Note>

Bun's `spawnSync` spawns processes 60% faster than the Node.js `child_process` module.

```bash terminal icon="terminal"
bun spawn.mjs
```

```txt
cpu: Apple M1 Max
runtime: bun 1.x (arm64-darwin)

benchmark              time (avg)             (min … max)       p75       p99      p995
--------------------------------------------------------- -----------------------------
spawnSync echo hi  888.14 µs/iter    (821.83 µs … 1.2 ms) 905.92 µs      1 ms   1.03 ms
```

```sh terminal icon="terminal"
node spawn.node.mjs
```

```txt
cpu: Apple M1 Max
runtime: node v18.9.1 (arm64-darwin)

benchmark              time (avg)             (min … max)       p75       p99      p995
--------------------------------------------------------- -----------------------------
spawnSync echo hi    1.47 ms/iter     (1.14 ms … 2.64 ms)   1.57 ms   2.37 ms   2.52 ms
```

---

## Reference

A reference of the Spawn API and types are shown below. The real types have complex generics to strongly type the `Subprocess` streams with the options passed to `Bun.spawn` and `Bun.spawnSync`. For full details, find these types as defined [bun.d.ts](https://github.com/oven-sh/bun/blob/main/packages/bun-types/bun.d.ts).

```ts See Typescript Definitions expandable
interface Bun {
  spawn(command: string[], options?: SpawnOptions.OptionsObject): Subprocess;
  spawnSync(command: string[], options?: SpawnOptions.OptionsObject): SyncSubprocess;

  spawn(options: { cmd: string[] } & SpawnOptions.OptionsObject): Subprocess;
  spawnSync(options: { cmd: string[] } & SpawnOptions.OptionsObject): SyncSubprocess;
}

namespace SpawnOptions {
  interface OptionsObject {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdio?: [Writable, Readable, Readable];
    stdin?: Writable;
    stdout?: Readable;
    stderr?: Readable;
    onExit?(
      subprocess: Subprocess,
      exitCode: number | null,
      signalCode: number | null,
      error?: ErrorLike,
    ): void | Promise<void>;
    ipc?(message: any, subprocess: Subprocess): void;
    serialization?: "json" | "advanced";
    windowsHide?: boolean;
    windowsVerbatimArguments?: boolean;
    argv0?: string;
    signal?: AbortSignal;
    timeout?: number;
    killSignal?: string | number;
    maxBuffer?: number;
    terminal?: TerminalOptions; // PTY (POSIX) / ConPTY (Windows) support
  }

  type Readable =
    | "pipe"
    | "inherit"
    | "ignore"
    | null // equivalent to "ignore"
    | undefined // to use default
    | BunFile
    | ArrayBufferView
    | number;

  type Writable =
    | "pipe"
    | "inherit"
    | "ignore"
    | null // equivalent to "ignore"
    | undefined // to use default
    | BunFile
    | ArrayBufferView
    | number
    | ReadableStream
    | Blob
    | Response
    | Request;
}

interface Subprocess extends AsyncDisposable {
  readonly stdin: FileSink | number | undefined | null;
  readonly stdout: ReadableStream<Uint8Array<ArrayBuffer>> | number | undefined | null;
  readonly stderr: ReadableStream<Uint8Array<ArrayBuffer>> | number | undefined | null;
  readonly readable: ReadableStream<Uint8Array<ArrayBuffer>> | number | undefined | null;
  readonly terminal: Terminal | undefined;
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly killed: boolean;

  kill(exitCode?: number | NodeJS.Signals): void;
  ref(): void;
  unref(): void;

  send(message: any): void;
  disconnect(): void;
  resourceUsage(): ResourceUsage | undefined;
}

interface SyncSubprocess {
  stdout: Buffer | undefined;
  stderr: Buffer | undefined;
  exitCode: number;
  success: boolean;
  resourceUsage: ResourceUsage;
  signalCode?: string;
  exitedDueToTimeout?: true;
  pid: number;
}

interface TerminalOptions {
  cols?: number;
  rows?: number;
  name?: string;
  data?: (terminal: Terminal, data: Uint8Array<ArrayBuffer>) => void;
  /** Called when PTY stream closes (EOF or error). exitCode is PTY lifecycle status (0=EOF, 1=error), not subprocess exit code. */
  exit?: (terminal: Terminal, exitCode: number, signal: string | null) => void;
  drain?: (terminal: Terminal) => void;
}

interface Terminal extends AsyncDisposable {
  readonly stdin: number;
  readonly stdout: number;
  readonly closed: boolean;
  write(data: string | BufferSource): number;
  resize(cols: number, rows: number): void;
  setRawMode(enabled: boolean): void;
  ref(): void;
  unref(): void;
  close(): void;
}

interface ResourceUsage {
  contextSwitches: {
    voluntary: number;
    involuntary: number;
  };

  cpuTime: {
    user: number;
    system: number;
    total: number;
  };
  maxRSS: number;

  messages: {
    sent: number;
    received: number;
  };
  ops: {
    in: number;
    out: number;
  };
  shmSize: number;
  signalCount: number;
  swapCount: number;
}

type Signal =
  | "SIGABRT"
  | "SIGALRM"
  | "SIGBUS"
  | "SIGCHLD"
  | "SIGCONT"
  | "SIGFPE"
  | "SIGHUP"
  | "SIGILL"
  | "SIGINT"
  | "SIGIO"
  | "SIGIOT"
  | "SIGKILL"
  | "SIGPIPE"
  | "SIGPOLL"
  | "SIGPROF"
  | "SIGPWR"
  | "SIGQUIT"
  | "SIGSEGV"
  | "SIGSTKFLT"
  | "SIGSTOP"
  | "SIGSYS"
  | "SIGTERM"
  | "SIGTRAP"
  | "SIGTSTP"
  | "SIGTTIN"
  | "SIGTTOU"
  | "SIGUNUSED"
  | "SIGURG"
  | "SIGUSR1"
  | "SIGUSR2"
  | "SIGVTALRM"
  | "SIGWINCH"
  | "SIGXCPU"
  | "SIGXFSZ"
  | "SIGBREAK"
  | "SIGLOST"
  | "SIGINFO";
```
