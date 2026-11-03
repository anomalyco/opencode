# Lua interpreter experiment

Standalone implementation of the **Lua 5.1** instruction set, targeting **5.1.5**. It is not a JavaScript translation and does not use an installed Lua interpreter. No Code Mode entrypoint imports it.

`vm.c` owns the fetch/decode/execute loop for all 38 opcodes. Lua-to-Lua calls iterate over register frames rather than recursing in C. Tail calls replace the caller's frame after closing captured registers; yields return control to the coroutine runtime. Calls, varargs and returns preserve Lua's multiple-result convention, including trailing nils.

The front end and runtime are **reused, not rewritten**: the build compiles the MIT-licensed Lua 5.1.5 lexer, parser, bytecode generator, tables, GC, coroutine machinery, C API and libraries. It extracts the value/coercion/metamethod helpers from upstream `lvm.c`, then builds our executor **instead of** the upstream instruction loop. Both source archives are checksum-pinned in the Makefile. See [LICENSE.lua](LICENSE.lua).

## Try it

From `packages/codemode/lua`, on a POSIX system with a C99 compiler, Make, curl, tar and shasum:

```sh
make                 # .build/lua-5.1.5/src/liblua.a (no libraries opened automatically)
make cli             # developer CLI with the standard libraries opened
.build/lua-5.1.5/src/lua -e 'local function f(...) return ... end; print(f(1,nil,3))'
make test            # targeted VM regressions
make conformance     # upstream language/standard-library suite
make test-debug      # allocator, C API, coroutine and hook tests with upstream test instrumentation
```

The first build downloads source; subsequent runs use `.build/`. The conformance target uses the 2006 official 5.1 suite. On a 64-bit host it skips the assertion that concatenating 4 GiB overflows `size_t`; the rest of `big.lua` still runs. Other platform/optional skips are reported by the suite (locales, dynamic C modules, internal test library). `test-debug` enables the internal test library separately. Its `code.lua` compiler-shape assertions are not a 5.1.5 compatibility gate: the unmodified 5.1.5 reference compiler also fails the expected instruction sequence at line 45.

## Boundary

This is an interpreter experiment, **not a sandbox**. The developer CLI is for trusted scripts: it has normal Lua file/process APIs and accepts binary chunks. No resource budget, host-value bridge, tool bindings, or Code Mode language switch is implemented. Lua 5.2+ syntax and semantics are outside this version target.
