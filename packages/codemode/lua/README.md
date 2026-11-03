# Lua in JavaScript

`runLua(source)` evaluates Lua 5.1 source synchronously **in the calling JavaScript process**. Each call starts with fresh globals. There is no native executable, Wasm, generated JavaScript, or runtime build step. The experiment is not imported by Code Mode; its existing JavaScript interpreter is unchanged.

From the repository root:

```sh
bun install --frozen-lockfile --filter @opencode/lua-experiment --ignore-scripts
cd packages/codemode/lua
node --input-type=module -e "import {runLua} from './index.js'; console.log(runLua('return 1, nil, false'))"
# [ 1, null, false ]
make test
```

The result is an array, not just the first Lua value. `return` produces `[]`; `return nil` produces `[null]`. Numbers, booleans, and strings cross directly. Strings (including the source) use the byte-string convention: one JS code unit per byte, `0`–`255`. To load a UTF-8 file without changing its bytes, read it with Node's `latin1` encoding. Returning a table, function or thread throws a `TypeError` instead of leaking a VM object. Uncaught Lua errors throw; Lua `pcall` and `coroutine.resume` preserve error objects inside the VM.

## Implementation

- [luaparse](https://github.com/fstirlitz/luaparse) parses in 5.1 mode. The small local patch records grouped expressions (the difference between `return f()` and `return (f())`) and fixes parsing of `break;` and `return 'end'`.
- `evaluate.js` evaluates the parsed tree, with lexical cells for captures. Each Lua activation is a generator that yields **call requests** to `vm.js`; calls do not recurse down the JS stack. The VM replaces frames for tail calls and owns the frame stack, resume values, protected-call boundaries and lifecycle of each coroutine.
- `library.js` provides the base and coroutine functions. Tables, operators and the string/pattern, table and math libraries reuse the MIT-licensed [v8lua](https://github.com/takano32/v8lua) modules. The runtime patch scopes their dynamic bindings to each synchronous invocation and uses the actual string metatable for indexing. We don't use v8lua's evaluator, CLI or host libraries.

`coroutine.create`, `resume`, `yield`, `wrap`, `status` and `running` follow the 5.1 model: the main thread is reported as nil, yielded values and resume arguments retain their arity, and a yield across `pcall`, a metamethod invoked by an operator, or a native callback fails instead of suspending. A protected call can still resume a *different* thread that yields.

## Compatibility and tests

`make test` runs the JavaScript regression suite, including the original `test/vm.lua`. That fixture exercises 100,000 tail calls with captured locals, nil-bearing return lists, coroutine resumption, recursive metamethods, a 26,001-element constructor, `loadstring` and chunk/line errors.

`make conformance` downloads the checksum-pinned official Lua 5.1 tests and runs **a subset** on JavaScript: `vararg.lua`, `pm.lua`, `locals.lua` (checking its first result inside Lua), and `math.lua` in its upstream `_soft` mode (skips its file-I/O section). This is **not** full Lua 5.1.5 conformance. In particular:

- No `io`, `os`, `package`/`require`, `debug`, C API, bytecode loading or `string.dump`. `load`/`loadstring` accept text; `print` writes to the host console.
- GC belongs to JavaScript. `collectgarbage` is a compatibility stub; weak tables, finalizers and Lua allocator behavior aren't implemented.
- Parser limits, stack limits, diagnostics, locale behavior and some library argument checks and numeric edge cases differ from PUC Lua. The interpreter has no instruction, time or allocation budget. Run **trusted** code only; this is not a sandbox.

### Optional native comparison

`vm.c` is the branch's earlier Lua 5.1.5 register-machine experiment. It is retained for developer comparisons only, and is never built or invoked by the JavaScript implementation. `make cli`, `make test-c`, `make conformance-c` and `make test-debug` are the separate C targets. They require a POSIX toolchain and download checksum-pinned Lua sources under `.build/`; see [LICENSE.lua](LICENSE.lua). The C suite skips a 32-bit-only overflow assertion on 64-bit hosts; its results are not JavaScript compatibility evidence.
