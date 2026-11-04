---
title: Bytecode Caching
description: Speed up JavaScript execution with bytecode caching in Bun's bundler
---

Bytecode caching is a build-time optimization that dramatically improves application startup time by pre-compiling your JavaScript to bytecode. For example, when compiling TypeScript's `tsc` with bytecode enabled, startup time improves by **2x**.

## Usage

### Basic usage (CommonJS)

Enable bytecode caching with the `--bytecode` flag. Without `--format`, this defaults to CommonJS:

```bash terminal icon="terminal"
bun build ./index.ts --target=bun --bytecode --outdir=./dist
```

This generates two files:

- `dist/index.js` - Your bundled JavaScript (CommonJS)
- `dist/index.jsc` - The bytecode cache file

At runtime, Bun automatically detects and uses the `.jsc` file:

```bash terminal icon="terminal"
bun ./dist/index.js  # Automatically uses index.jsc
```

### With standalone executables

When creating executables with `--compile`, bytecode is embedded into the binary. Both ESM and CommonJS formats are supported:

```bash terminal icon="terminal"
# ESM (requires --compile)
bun build ./cli.ts --compile --bytecode --format=esm --outfile=mycli

# CommonJS (works with or without --compile)
bun build ./cli.ts --compile --bytecode --outfile=mycli
```

The resulting executable contains both the code and bytecode, giving you maximum performance in a single file.

### ESM bytecode

ESM bytecode requires `--compile` because Bun embeds module metadata (import/export information) in the compiled binary. This metadata allows the JavaScript engine to skip parsing entirely at runtime.

Without `--compile`, ESM bytecode would still require parsing the source to analyze module dependencies—defeating the purpose of bytecode caching.

### Combining with other optimizations

Bytecode works great with minification and source maps:

```bash terminal icon="terminal"
bun build --compile --bytecode --minify --sourcemap ./cli.ts --outfile=mycli
```

- `--minify` reduces code size before generating bytecode (less code -> less bytecode)
- `--sourcemap` preserves error reporting (errors still point to original source)
- `--bytecode` eliminates parsing overhead

## Performance impact

The performance improvement scales with your codebase size:

| Application size          | Typical startup improvement |
| ------------------------- | --------------------------- |
| Small CLI (< 100 KB)      | 1.5-2x faster               |
| Medium-large app (> 5 MB) | 2.5x-4x faster              |

Larger applications benefit more because they have more code to parse.

## When to use bytecode

### Great for:

#### CLI tools

- Invoked frequently (linters, formatters, git hooks)
- Startup time is the entire user experience
- Users notice the difference between 90ms and 45ms startup
- Example: TypeScript compiler, Prettier, ESLint

#### Build tools and task runners

- Run hundreds or thousands of times during development
- Milliseconds saved per run compound quickly
- Developer experience improvement
- Example: Build scripts, test runners, code generators

#### Standalone executables

- Distributed to users who care about snappy performance
- Single-file distribution is convenient
- File size less important than startup time
- Example: CLIs distributed via npm or as binaries

### Skip it for:

- ❌ **Small scripts**
- ❌ **Code that runs once**
- ❌ **Development builds**
- ❌ **Size-constrained environments**

## Limitations

### Version compatibility

Bytecode is **not portable across Bun versions**. The bytecode format is tied to JavaScriptCore's internal representation, which changes between versions.

When you update Bun, you must regenerate bytecode:

```bash terminal icon="terminal"
# After updating Bun
bun build --bytecode ./index.ts --outdir=./dist
```

If bytecode doesn't match the current Bun version, it's automatically ignored and your code falls back to parsing the JavaScript source. Your app still runs — the performance optimization is skipped.

**Best practice**: Generate bytecode as part of your CI/CD build process. Don't commit `.jsc` files to git. Regenerate them whenever you update Bun.

### Source code still required

- The `.js` file (your bundled source code)
- The `.jsc` file (the bytecode cache)

At runtime:

1. Bun loads the `.js` file, sees a `@bytecode` pragma, and checks the `.jsc` file
2. Bun loads the `.jsc` file
3. Bun validates the bytecode hash matches the source
4. If valid, Bun uses the bytecode
5. If invalid, Bun falls back to parsing the source

### Bytecode is not obfuscation

Bytecode **does not obscure your source code**. It's an optimization, not a security measure.

## Production deployment

### Docker

Include bytecode generation in your Dockerfile:

```dockerfile Dockerfile icon="docker"
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun build --bytecode --minify --sourcemap \
  --target=bun \
  --outdir=./dist \
  --compile \
  ./src/server.ts --outfile=./dist/server

FROM oven/bun:1 AS runner
WORKDIR /app
COPY --from=builder /dist/server /app/server
CMD ["./server"]
```

The bytecode is architecture-independent.

### CI/CD

Generate bytecode during your build pipeline:

```yaml workflow.yml icon="file-code"
# GitHub Actions
- name: Build with bytecode
  run: |
    bun install
    bun build --bytecode --minify \
      --outdir=./dist \
      --target=bun \
      ./src/index.ts
```

## Debugging

### Verify bytecode is being used

Check that the `.jsc` file exists:

```bash terminal icon="terminal"
ls -lh dist/
```

```txt
-rw-r--r--  1 user  staff   245K  index.js
-rw-r--r--  1 user  staff   1.1M  index.jsc
```

The `.jsc` file should be 2-8x larger than the `.js` file.

To log if bytecode is being used, set `BUN_JSC_verboseDiskCache=1` in your environment.

On success, it will log something like:

```txt
[Disk cache] cache hit for sourceCode
```

If you see a cache miss, it will log something like:

```txt
[Disk cache] cache miss for sourceCode
```

It's normal for it it to log a cache miss multiple times since Bun doesn't currently bytecode cache JavaScript code used in builtin modules.

### Common issues

**Bytecode silently ignored**: Usually caused by a Bun version update. The cache version doesn't match, so bytecode is rejected. Regenerate to fix.

**File size too large**: This is expected. Consider:

- Using `--minify` to reduce code size before bytecode generation
- Compressing `.jsc` files for network transfer (gzip/brotli)
- Evaluating if the startup performance gain is worth the size increase

## What is bytecode?

When you run JavaScript, the JavaScript engine doesn't execute your source code directly. Instead, it goes through several steps:

1. **Parsing**: The engine reads your JavaScript source code and converts it into an Abstract Syntax Tree (AST)
2. **Bytecode compilation**: The AST is compiled into bytecode - a lower-level representation that's faster to execute
3. **Execution**: The bytecode is executed by the engine's interpreter or JIT compiler

Bytecode is an intermediate representation - it's lower-level than JavaScript source code, but higher-level than machine code. Think of it as assembly language for a virtual machine. Each bytecode instruction represents a single operation like "load this variable," "add two numbers," or "call this function."

This happens **every single time** you run your code. If you have a CLI tool that runs 100 times a day, your code gets parsed 100 times. If you have a serverless function with frequent cold starts, parsing happens on every cold start.

With bytecode caching, Bun moves steps 1 and 2 to the build step. At runtime, the engine loads the pre-compiled bytecode and jumps straight to execution.

### Why lazy parsing makes this even better

Modern JavaScript engines use a clever optimization called **lazy parsing**. They don't parse all your code upfront - instead, functions are only parsed when they're first called:

```js
// Without bytecode caching:
function rarely_used() {
  // This 500-line function is only parsed
  // when it's actually called
}

function main() {
  console.log("Starting app");
  // rarely_used() is never called, so it's never parsed
}
```

This means parsing overhead isn't just a startup cost - it happens throughout your application's lifetime as different code paths execute. With bytecode caching, **all functions are pre-compiled**, even the ones that are lazily parsed. The parsing work happens once at build time instead of being distributed throughout your application's execution.

## The bytecode format

### Inside a .jsc file

A `.jsc` file contains a serialized bytecode structure. Understanding what's inside helps explain both the performance benefits and the file size tradeoff.

**Header section** (validated on every load):

- **Cache version**: A hash tied to the JavaScriptCore framework version. This ensures bytecode generated with one version of Bun only runs with that exact version.
- **Code block type tag**: Identifies whether this is a Program, Module, Eval, or Function code block.

**SourceCodeKey** (validates bytecode matches source):

- **Source code hash**: A hash of the original JavaScript source code. Bun verifies this matches before using the bytecode.
- **Source code length**: The exact length of the source, for additional validation.
- **Compilation flags**: Critical compilation context like strict mode, whether it's a script vs module, eval context type, etc. The same source code compiled with different flags produces different bytecode.

**Bytecode instructions**:

- **Instruction stream**: The actual bytecode opcodes - the compiled representation of your JavaScript. This is a variable-length sequence of bytecode instructions.
- **Metadata table**: Each opcode has associated metadata - things like profiling counters, type hints, and execution counts (even if not yet populated).
- **Jump targets**: Pre-computed addresses for control flow (if/else, loops, switch statements).
- **Switch tables**: Optimized lookup tables for switch statements.

**Constants and identifiers**:

- **Constant pool**: All literal values in your code - numbers, strings, booleans, null, undefined. These are stored as actual JavaScript values (JSValues) so they don't need to be parsed from source at runtime.
- **Identifier table**: All variable and function names used in the code. Stored as deduplicated strings.
- **Source code representation markers**: Flags indicating how constants should be represented (as integers, doubles, big ints, etc.).

**Function metadata** (for each function in your code):

- **Register allocation**: How many registers (local variables) the function needs - `thisRegister`, `scopeRegister`, `numVars`, `numCalleeLocals`, `numParameters`.
- **Code features**: A bitmask of function characteristics: is it a constructor? an arrow function? does it use `super`? does it have tail calls? These affect how the function is executed.
- **Lexically scoped features**: Strict mode and other lexical context.
- **Parse mode**: The mode in which the function was parsed (normal, async, generator, async generator).

**Nested structures**:

- **Function declarations and expressions**: Each nested function gets its own bytecode block, recursively. A file with 100 functions has 100 separate bytecode blocks, all nested in the structure.
- **Exception handlers**: Try/catch/finally blocks with their boundaries and handler addresses pre-computed.
- **Expression info**: Maps bytecode positions back to source code locations for error reporting and debugging.

### What bytecode does NOT contain

Importantly, **bytecode does not embed your source code**. Instead:

- The JavaScript source is stored separately (in the `.js` file)
- The bytecode only stores a hash and length of the source
- At load time, Bun validates the bytecode matches the current source code

This is why you need to deploy both the `.js` and `.jsc` files. The `.jsc` file is useless without its corresponding `.js` file.

## The tradeoff: file size

Bytecode files are significantly larger than source code - typically 2-8x larger.

### Why is bytecode so much larger?

**Bytecode instructions are verbose**:
A single line of minified JavaScript might compile to dozens of bytecode instructions. For example:

```js
const sum = arr.reduce((a, b) => a + b, 0);
```

Compiles to bytecode that:

- Loads the `arr` variable
- Gets the `reduce` property
- Creates the arrow function (which itself has bytecode)
- Loads the initial value `0`
- Sets up the call with the right number of arguments
- Actually performs the call
- Stores the result in `sum`

Each of these steps is a separate bytecode instruction with its own metadata.

**Constant pools store everything**:
Every string literal, number, property name - everything gets stored in the constant pool. Even if your source code has `"hello"` a hundred times, the constant pool stores it once, but the identifier table and constant references add overhead.

**Per-function metadata**:
Each function - even small one-line functions - gets its own complete metadata:

- Register allocation info
- Code features bitmask
- Parse mode
- Exception handlers
- Expression info for debugging

A file with 1,000 small functions has 1,000 sets of metadata.

**Profiling data structures**:
Even though profiling data isn't populated yet, the _structures_ to hold profiling data are allocated. This includes:

- Value profile slots (tracking what types flow through each operation)
- Array profile slots (tracking array access patterns)
- Binary arithmetic profile slots (tracking number types in math operations)
- Unary arithmetic profile slots

These take up space even when empty.

**Pre-computed control flow**:
Jump targets, switch tables, and exception handler boundaries are all pre-computed and stored. This makes execution faster but increases file size.

### Mitigation strategies

**Compression**:
Bytecode compresses extremely well with gzip/brotli (60-70% compression). The repetitive structure and metadata compress efficiently.

**Minification first**:
Using `--minify` before bytecode generation helps:

- Shorter identifiers → smaller identifier table
- Dead code elimination → less bytecode generated
- Constant folding → fewer constants in the pool

**The tradeoff**:
You're trading 2-4x larger files for 2-4x faster startup. For CLIs, this is usually worth it. For long-running servers where a few megabytes of disk space don't matter, it's even less of an issue.

## Versioning and portability

### Cross-architecture portability: ✅

Bytecode is **architecture-independent**. You can:

- Build on macOS ARM64, deploy to Linux x64
- Build on Linux x64, deploy to AWS Lambda ARM64
- Build on Windows x64, deploy to macOS ARM64

The bytecode contains abstract instructions that work on any architecture. Architecture-specific optimizations happen during JIT compilation at runtime, not in the cached bytecode.

### Cross-version portability: ❌

Bytecode is **not stable across Bun versions**. Here's why:

**Bytecode format changes**:
JavaScriptCore's bytecode format evolves. New opcodes get added, old ones get removed or changed, metadata structures change. Each version of JavaScriptCore has a different bytecode format.

**Version validation**:
The cache version in the `.jsc` file header is a hash of the JavaScriptCore framework. When Bun loads bytecode:

1. It extracts the cache version from the `.jsc` file
2. It computes the current JavaScriptCore version
3. If they don't match, the bytecode is **silently rejected**
4. Bun falls back to parsing the `.js` source code

Your application still runs — the performance optimization is skipped.

**Graceful degradation**:
This design means bytecode caching "fails open" - if anything goes wrong (version mismatch, corrupted file, missing file), your code still runs normally. You might see slower startup, but you won't see errors.

## Unlinked vs. linked bytecode

JavaScriptCore makes a crucial distinction between "unlinked" and "linked" bytecode. This separation is what makes bytecode caching possible:

### Unlinked bytecode (what's cached)

The bytecode saved in `.jsc` files is **unlinked bytecode**. It contains:

- The compiled bytecode instructions
- Structural information about the code
- Constants and identifiers
- Control flow information

But it **doesn't** contain:

- Pointers to actual runtime objects
- JIT-compiled machine code
- Profiling data from previous runs
- Call link information (which functions call which)

Unlinked bytecode is **immutable and shareable**. Multiple executions of the same code can all reference the same unlinked bytecode.

### Linked bytecode (runtime execution)

When Bun runs bytecode, it "links" it - creating a runtime wrapper that adds:

- **Call link information**: As your code runs, the engine learns which functions call which and optimizes those call sites.
- **Profiling data**: The engine tracks how many times each instruction executes, what types of values flow through the code, array access patterns, etc.
- **JIT compilation state**: References to baseline JIT or optimizing JIT (DFG/FTL) compiled versions of hot code.
- **Runtime objects**: Pointers to actual JavaScript objects, prototypes, scopes, etc.

This linked representation is created fresh every time you run your code. This allows:

1. **Caching the expensive work** (parsing and compilation to unlinked bytecode)
2. **Still collecting runtime profiling data** to guide optimizations
3. **Still applying JIT optimizations** based on actual execution patterns

Bytecode caching moves expensive work (parsing and compiling to bytecode) from runtime to build time. For applications that start frequently, this can halve your startup time at the cost of larger files on disk.

For production CLIs and serverless deployments, the combination of `--bytecode --minify --sourcemap` gives you the best performance while maintaining debuggability.
