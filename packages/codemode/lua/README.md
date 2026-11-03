# Lua in JavaScript

There are two entry points sharing the same Lua AST evaluator, lexical cells, activation frames and call trampoline in `evaluate.js`. Neither runs generated JavaScript, Wasm or a native executable.

## Code Mode sandbox

`sandbox.js` is the Lua execution profile for Code Mode. It uses fresh, Map-backed tables and an explicit native-function allowlist, **not** the prototype's v8lua runtime or standard libraries. `evaluateLua` advances a generator; it yields either a scheduler checkpoint or a capability path with detached JSON arguments. While the caller awaits a tool, no Lua executes and no ambient state is installed. The bridge resumes that same generator with validated inert JSON or closes it on interruption. `pcall` can recover from ordinary Lua and host errors, never resource exhaustion or interruption.

Source is limited to 32 KiB, 8,192 AST nodes and 48 levels of syntax. The evaluator caps normal activations at 96 and nested protected calls at 24. Each execution has 500,000 weighted work units, with checkpoints after 256 units at evaluator boundaries. Table writes, local lookup, argument copying and boundary traversal consume fuel too. Tables have at most 8,192 entries; string-producing operations check a 256 KiB per-string limit and a cumulative 8 MiB budget before materialization. Boundary output is capped at 1 MiB per call/result and 32 levels, including repeated expansion of shared references. These are implementation budgets, not an OS heap or CPU-time quota. Host tool execution, canonicalization of host-owned objects, timeout handling and log retention belong to the bridge.

The allowlist includes `type`, `tostring`, base-10 `tonumber`, `assert`, `error`, `pcall`, `pairs`, `ipairs`, `math.{abs,ceil,floor,sqrt,min,max,pi,huge}`, `string.{len,sub,rep,lower,upper}`, append-only `table.insert` and `table.concat`. Calls to `print` are capabilities rather than access to the host console. No patterns, format strings, metatables, dynamic loading, debug library, coroutine library or ambient JS objects. Source and JSON use Unicode; inside the VM strings are UTF-8 bytes. Exporting an invalid byte sequence as JSON fails. See the [Code Mode guide](../README.md) for table/JSON conventions.

## Trusted compatibility prototype

`runLua(source)` evaluates Lua 5.1 source synchronously **in the calling JavaScript process**. It starts with fresh globals but is unmetered. Code Mode does not import this entry point. **Trusted programs only.**

From the repository root:

```sh
bun install --frozen-lockfile --filter @opencode/lua-experiment --ignore-scripts
cd packages/codemode/lua
node --input-type=module -e "import {runLua} from './index.js'; console.log(runLua('return 1, nil, false'))"
# [ 1, null, false ]
bun run test
bun run conformance
```

The result is an array, not just the first Lua value. `return` produces `[]`; `return nil` produces `[null]`. Numbers, booleans, and strings cross directly. Strings (including the source) use the byte-string convention: one JS code unit per byte, `0`–`255`. To load a UTF-8 file without changing its bytes, read it with Node's `latin1` encoding. Returning a table, function or thread throws a `TypeError` instead of leaking a VM object. Uncaught Lua errors throw; Lua `pcall` and `coroutine.resume` preserve error objects inside the VM.

## Implementation

- [luaparse](https://github.com/fstirlitz/luaparse) parses in 5.1 mode. The small local patch records grouped expressions (the difference between `return f()` and `return (f())`) and fixes parsing of `break;` and `return 'end'`.
- `evaluate.js` evaluates the parsed tree, with lexical cells for captures. Each Lua activation is a generator that yields **call requests** to the shared frame trampoline; calls do not recurse down the JS stack. The trusted VM in `vm.js` owns prototype-specific values, coroutine state and native dispatch.
- `library.js` provides the base and coroutine functions. Tables, operators and the string/pattern, table and math libraries reuse the MIT-licensed [v8lua](https://github.com/takano32/v8lua) modules. The runtime patch scopes their dynamic bindings to each synchronous invocation and uses the actual string metatable for indexing. We don't use v8lua's evaluator, CLI or host libraries.

`coroutine.create`, `resume`, `yield`, `wrap`, `status` and `running` follow the 5.1 model: the main thread is reported as nil, yielded values and resume arguments retain their arity, and a yield across `pcall`, a metamethod invoked by an operator, or a native callback fails instead of suspending. A protected call can still resume a _different_ thread that yields.

## Compatibility and tests

`bun run test` runs the JavaScript regression suite with Node, including the original `test/vm.lua`. That fixture exercises 100,000 tail calls with captured locals, nil-bearing return lists, coroutine resumption, recursive metamethods, a 26,001-element constructor, `loadstring` and chunk/line errors.

`bun run conformance` reads the checksum-pinned [official Lua 5.1 test archive](https://www.lua.org/tests/) in memory. To run offline, pass a local copy: `bun run conformance /path/to/lua5.1-tests.tar.gz`. It runs `vararg.lua`, `pm.lua`, `locals.lua` (checking its first result inside Lua), and `math.lua` in upstream `_soft` mode. That mode returns at line 122, before the file I/O, NaN, coercion and random-number tests that follow. This is **not** full Lua 5.1.5 conformance. In particular:

- No `io`, `os`, `package`/`require`, `debug`, C API, bytecode loading or `string.dump`. `load`/`loadstring` accept text; `print` writes to the host console.
- GC belongs to JavaScript. `collectgarbage` is a compatibility stub; weak tables, finalizers and Lua allocator behavior aren't implemented.
- Parser limits, stack limits, diagnostics, locale behavior and some library argument checks and numeric edge cases differ from PUC Lua. `runLua` has no instruction, time or allocation budget. Run **trusted** code only with the prototype.
