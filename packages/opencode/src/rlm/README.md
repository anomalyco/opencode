# RLM - Recursive Language Model

Native TypeScript port of the [RLM](https://github.com/alexzhang13/rlm) system for OpenCode.
Provides iterative REPL-based reasoning where an LLM can execute JavaScript code,
query sub-LLMs recursively, and build up answers incrementally.

## Architecture Overview

```
                        User sends message
                               |
                               v
                    +---------------------+
                    |    session/llm.ts    |
                    |  resolveRLMConfig()  |
                    +---------------------+
                               |
                     rlm enabled?  small model?
                     /                        \
                   yes                        no (or small)
                   /                            \
                  v                              v
      +---------------------+          Normal Vercel AI SDK
      | createRLMProvider() |          streamText() / generateText()
      |    provider.ts      |
      +---------------------+
                  |
                  | returns LanguageModelV2
                  v
      +---------------------------+
      |   OpenCode calls          |
      |   streamText({ model })   |
      |   with RLM as the model   |
      +---------------------------+
                  |
                  | triggers doStream()
                  v
  +-----------------------------------------+
  |         provider.ts doStream()          |
  |                                         |
  |  1. Extract user content from prompt    |
  |  2. Call rlmCompletion() with hooks     |
  |  3. Emit stream parts:                 |
  |     - reasoning-start/delta/end         |
  |       (one per iteration)               |
  |     - text-start/delta/end              |
  |       (final answer)                    |
  |     - finish                            |
  +-----------------------------------------+
                  |
                  v
  +-----------------------------------------+
  |                                         |
  |          rlm.ts rlmCompletion()         |
  |           (Main Engine Loop)            |
  |                                         |
  |  See detailed diagram below             |
  |                                         |
  +-----------------------------------------+
```

## Detailed Engine Flow

```
  rlmCompletion(input)
         |
         v
  +------------------+
  | depth >= maxDepth |--yes--> fallbackAnswer(): simple LLM call, return
  +------------------+
         | no
         v
  +-------------------------------+
  | Initialize:                   |
  |  - Get language model         |
  |  - Get sub-model (or same)    |
  |  - Create LocalREPL           |
  |  - repl.start()               |
  |  - Build system prompt        |
  |    (metadata + instructions)  |
  +-------------------------------+
         |
         v
  +-------------------------------+
  | messageHistory = [            |
  |   { system: RLM_SYSTEM_PROMPT |
  |     + JS REPL instructions }, |
  |   { assistant: context        |
  |     metadata string }         |
  | ]                             |
  +-------------------------------+
         |
         v
  ===================================
  ||  ITERATION LOOP (i = 0..max)  ||
  ===================================
         |
         v
  +-------------------------------+
  | Build current prompt:         |
  |   messageHistory              |
  |   + buildUserPrompt(          |
  |       rootPrompt, i,          |
  |       contextCount)           |
  |                               |
  | (iteration 0 includes         |
  |  safeguard: "you haven't      |
  |  seen the context yet")       |
  +-------------------------------+
         |
         v
  +-------------------------------+         +---------------------+
  | completionTurn()              |         |                     |
  |                               |         |  Vercel AI SDK      |
  | 1. generateText({             |-------->|  generateText()     |
  |      model: language,         |         |  to the root LLM    |
  |      messages: prompt })      |<--------|                     |
  |                               |         +---------------------+
  | 2. Track usage tokens         |
  |                               |
  | 3. hooks.onLLMResponse()      |
  |    (emits reasoning-delta     |
  |     with the raw response)    |
  +-------------------------------+
         |
         | raw LLM response text
         v
  +-------------------------------+
  | findCodeBlocks(response)      |
  | (parsing.ts)                  |
  |                               |
  | Regex: ```repl\n...\n```      |
  | Returns string[] of code      |
  +-------------------------------+
         |
         | code blocks found?
         |
    no --+---------- yes
    |                  |
    |                  v
    |    +-----------------------------------+
    |    | FOR EACH code block:              |
    |    |                                   |
    |    |   repl.executeCode(code)          |
    |    |   (environment.ts)                |
    |    |                                   |
    |    |   hooks.onCodeExecuted()          |
    |    |   (emits reasoning-delta with     |
    |    |    truncated code + REPL output)  |
    |    +-----------------------------------+
    |                  |
    |<-----------------+
    |
    v
  +-------------------------------+
  | findFinalAnswerAsync(         |
  |   response, repl.executeCode) |
  | (parsing.ts)                  |
  |                               |
  | Checks for:                   |
  |  - FINAL_VAR(name)            |
  |    -> executes console.log(   |
  |       FINAL_VAR("name"))      |
  |    -> returns stdout           |
  |  - FINAL(answer text)         |
  |    -> returns captured text   |
  +-------------------------------+
         |
    found final answer?
         |
    yes--+--------no
    |              |
    v              v
  +----------+  +---------------------------+
  | Return   |  | Format iteration for      |
  | {        |  | message history:           |
  |  response|  |                            |
  |  usage   |  | formatIteration()          |
  |  time    |  | (parsing.ts)               |
  |  iters   |  |                            |
  | }        |  | -> assistant msg: response |
  +----------+  | -> user msg per code block:|
                |    "Code executed:          |
                |     ```javascript           |
                |     ...code...              |
                |     ```                     |
                |     REPL output: ..."       |
                +---------------------------+
                         |
                         v
                  Append to messageHistory
                         |
                         v
                  +---------------+
                  | Next iteration|
                  | (back to top  |
                  |  of loop)     |
                  +---------------+

  ===================================
  || END ITERATION LOOP            ||
  ===================================
         |
         | (max iterations reached)
         v
  +-------------------------------+
  | getDefaultAnswer()            |
  |                               |
  | Appends "Please provide a     |
  | final answer..." to history   |
  | and calls generateText()      |
  | one more time                 |
  +-------------------------------+
         |
         v
     Return result
```

## JavaScript REPL Execution Model

The REPL uses Node's `vm` module (`vm.createContext` / `vm.runInContext`) for
sandboxed execution. Code runs in an isolated context with only whitelisted
globals — no access to `process`, `require`, `Bun`, `module`, or any Node/Bun
builtins.

```
  executeCode(code)
         |
         v
  +---------------------------------+
  | Build fake console object:      |
  |   .log()   -> stdoutParts[]     |
  |   .info()  -> stdoutParts[]     |
  |   .error() -> stderrParts[]     |
  |   .warn()  -> stderrParts[]     |
  |   .dir()   -> stdoutParts[]     |
  +---------------------------------+
         |
         v
  +---------------------------------+
  | Inject fake console into        |
  | this.ctx.console                |
  +---------------------------------+
         |
         v
  +---------------------------------+
  | hoistDeclarations(code)         |
  |                                 |
  | Transforms top-level const/let  |
  | into bare assignments so they   |
  | appear on the vm context object |
  | (visible in serializeLocals     |
  | and SHOW_VARS).                 |
  |                                 |
  | e.g. "const x = 42" → "x = 42" |
  +---------------------------------+
         |
         v
  +---------------------------------+
  | Wrap in async IIFE:             |
  |   (async () => {                |
  |     <processed code>            |
  |   })()                          |
  +---------------------------------+
         |
         v
   +---------------------------------+
  | vm.runInContext(                 |
  |   wrappedCode,                  |
  |   this.ctx,                     |
  |   { timeout: timeoutMs }        |
  | )                               |
  |                                 |
  | Sync timeout: vm.runInContext   |
  | terminates synchronous infinite |
  | loops (e.g. while(true){})      |
  +---------------------------------+
         |
         v
  +---------------------------------+
  | Await the returned promise      |
  | with Promise.race timeout       |
  |                                 |
  | Async timeout: catches hanging  |
  | awaits (e.g. infinite Promise)  |
  | Default: 30 seconds             |
  +---------------------------------+
         |
    success?
    /       \
  yes       no
  |          |
  |          v
  |    +---------------------+
  |    | Catch error         |
  |    | Push to stderrParts |
  |    +---------------------+
  |          |
  |<---------+
  |
  v
  +---------------------------------+
  | Return REPLResult:              |
  |   stdout: stdoutParts.join("")  |
  |   stderr: stderrParts.join("")  |
  |   locals: serializeLocals()     |
  |   executionTime                 |
  +---------------------------------+
```

### Sandboxed Globals (SANDBOX_GLOBALS)

Only these globals are available to code running in the vm context:

```
  Constructors:   Array, ArrayBuffer, BigInt, Boolean, DataView, Date,
                  Error, EvalError, Float32/64Array, Int8/16/32Array,
                  Map, Number, Object, Promise, Proxy, RangeError,
                  ReferenceError, RegExp, Set, String, Symbol,
                  SyntaxError, TypeError, URIError, Uint8/16/32Array,
                  Uint8ClampedArray, WeakMap, WeakSet, WeakRef

  Utilities:      JSON, Math, decodeURI, decodeURIComponent,
                  encodeURI, encodeURIComponent, isFinite, isNaN,
                  parseFloat, parseInt, structuredClone

  Async:          setTimeout, clearTimeout, setInterval,
                  clearInterval, queueMicrotask

  Constants:      Infinity, NaN, undefined

  BLOCKED:        process, require, Bun, module, __dirname,
                  __filename, import(), globalThis builtins
```

### Declaration Hoisting (hoistDeclarations)

Top-level `const`/`let`/`var` declarations are transformed into bare
assignments before execution. This ensures the variables are set as
properties on the vm context object, making them visible in
`serializeLocals()` and `SHOW_VARS()`.

```
  Input code                      →  Processed code
  ─────────────────────────────────────────────────────
  const x = 42                    →  x = 42
  let a = 1, b = 2               →  a = 1; b = 2
  let x                           →  x = undefined
  const [a, b] = [1, 2]          →  [a, b] = [1, 2]
  const { a, b } = obj           →  ;({ a, b } = obj)
  function f() { const y = 1 }   →  (unchanged — depth > 0)
```

The transformation:
- Only operates at brace depth 0 (top-level)
- Tracks brace depth across lines, skipping braces in strings/comments
- Handles simple, multiple declarators, array/object destructuring
- Preserves nested declarations inside functions/blocks unchanged

### Variable Persistence

```
  this.ctx (vm.Context — persistent across all executeCode() calls)
  +-----------------------------------------------+
  |  SANDBOX GLOBALS (at creation):                |
  |    Math, JSON, Array, Object, Promise,         |
  |    Map, Set, RegExp, Date, setTimeout, ...     |
  |    (see SANDBOX_GLOBALS constant)              |
  |                                                |
  |  INJECTED HELPERS (at start()):                |
  |    llm_query      -> async handler (LLM call)  |
  |    llm_query_batched -> async handler (batch)  |
  |    FINAL_VAR      -> retrieves var from ctx    |
  |    SHOW_VARS      -> lists user variables      |
  |                                                |
  |  INJECTED (at each executeCode()):             |
  |    console        -> fake console (captures    |
  |                      stdout/stderr)            |
  |                                                |
  |  CONTEXT (at start() / loadContext()):         |
  |    context_0      -> initial context payload   |
  |    context        -> alias for context_0       |
  |    context_1..N   -> additional contexts       |
  |                                                |
  |  USER VARIABLES (from executed code):          |
  |    x, y, result, fibonacci, chunks, ...        |
  |    (bare assignments become properties on      |
  |     the context; hoistDeclarations converts    |
  |     const/let to bare assignments)             |
  +-----------------------------------------------+
  |                                                |
  |  INTERNAL_NAMES set (excluded from             |
  |  serializeLocals and SHOW_VARS):               |
  |    llm_query, llm_query_batched,               |
  |    FINAL_VAR, SHOW_VARS, console               |
  +-----------------------------------------------+
```

## Sub-LLM Query Flow (llm_query from REPL)

```
  LLM writes: answer = await llm_query("What is X?")
                          |
                          v
                +-----------------------+
                | scope.llm_query()     |
                | (environment.ts)      |
                +-----------------------+
                          |
                          v
                +-----------------------+
                | llmQueryHandler()     |
                | (defined in rlm.ts)   |
                +-----------------------+
                          |
                          v
                +-----------------------+
                | generateText({        |
                |   model: subLanguage, |
                |   messages: [         |
                |     { role: "user",   |
                |       content: prompt |
                |     }                 |
                |   ]                   |
                | })                    |
                +-----------------------+
                          |
                          v
                +-----------------------+
                | Vercel AI SDK         |
                | calls the sub-model   |
                | (may be same as root  |
                |  or a different model)|
                +-----------------------+
                          |
                          v
                +-----------------------+
                | Track usage tokens    |
                | in totalUsage         |
                +-----------------------+
                          |
                          v
                Return result.text
                (back to user code
                 as the resolved
                 await value)
```

## OpenCode Integration Points

```
  +------------------------------------------------------+
  |                    opencode.json                      |
  |                                                      |
  |  {                                                   |
  |    "rlm": {                      // global config    |
  |      "enabled": true,                                |
  |      "max_iterations": 5,                            |
  |      "max_depth": 1,                                 |
  |      "verbose": false,                               |
  |      "sub_model": "provider/model-id"                |
  |    }                                                 |
  |  }                                                   |
  +------------------------------------------------------+
         |
         v
  +------------------------------------------------------+
  |                config/config.ts                      |
  |                                                      |
  |  Config.Info schema includes:                        |
  |    rlm: {                                            |
  |      enabled, max_iterations, max_depth,             |
  |      verbose, sub_model                              |
  |    }                                                 |
  +------------------------------------------------------+
         |
         v
  +------------------------------------------------------+
  |                agent/agent.ts                        |
  |                                                      |
  |  Agent.Info schema includes:                         |
  |    rlm: {                                            |
  |      enabled, max_iterations, max_depth, sub_model   |
  |    }                                                 |
  |                                                      |
  |  (per-agent overrides, merged with global config)    |
  +------------------------------------------------------+
         |
         v
  +------------------------------------------------------+
  |               session/llm.ts                         |
  |                                                      |
  |  resolveRLMConfig(agent, globalConfig)               |
  |    -> checks agent.rlm first (per-agent override)    |
  |    -> falls back to globalConfig.rlm                 |
  |    -> returns undefined if disabled                  |
  |    -> skips if input.small (title generation etc.)   |
  |                                                      |
  |  If enabled:                                         |
  |    language = createRLMProvider({                     |
  |      model, subModel, config                         |
  |    })                                                |
  |    // replaces the normal LanguageModelV2            |
  |    // all subsequent streamText() calls go           |
  |    // through the RLM engine                         |
  +------------------------------------------------------+
```

## Stream Part Emission (what the UI sees)

```
  Iteration 1:
    stream-start
    reasoning-start  (id: rlm-reasoning-1)
    reasoning-delta  "--- Iteration 1 ---\n<LLM response>\n"
    reasoning-delta  "\n[REPL] x = 6 * 7...\n42\n"
    reasoning-end    (id: rlm-reasoning-1)

  Iteration 2:
    reasoning-start  (id: rlm-reasoning-2)
    reasoning-delta  "--- Iteration 2 ---\n<LLM response with FINAL()>\n"
    reasoning-end    (id: rlm-reasoning-2)

  Final answer:
    text-start       (id: rlm-text-3)
    text-delta       "The result of 6*7 is "
    text-delta       "42"
    text-end         (id: rlm-text-3)
    finish           { finishReason: "stop", usage: {...} }
```

In the OpenCode UI:
- **Reasoning pane**: shows all iteration content (LLM thinking + REPL execution results)
- **Text output**: shows only the final answer

## File Map

```
  src/rlm/
  ├── index.ts          Barrel exports
  ├── types.ts          Type definitions, usage tracking, config defaults
  ├── prompts.ts        System prompt, user prompt builders
  ├── parsing.ts        Code block extraction, FINAL/FINAL_VAR detection
  ├── environment.ts    JavaScript REPL (vm.createContext sandbox + hoistDeclarations)
  ├── rlm.ts            Main engine loop (rlmCompletion)
  ├── provider.ts       LanguageModelV2 wrapper (createRLMProvider)
  └── README.md         This file

  Integration points:
  ├── src/config/config.ts     Global RLM config schema
  ├── src/agent/agent.ts       Per-agent RLM config schema
  └── src/session/llm.ts       RLM activation + provider wrapping
```

## Example Session Trace

```
  User: "What is the 15th Fibonacci number? Use code to compute it."

  ┌─────────────────────────────────────────────────────┐
  │ Iteration 1                                         │
  │                                                     │
  │ LLM response:                                       │
  │   "Let me check the context and compute this."      │
  │   ```repl                                           │
  │   console.log("Context:", context)                  │
  │   ```                                               │
  │                                                     │
  │ REPL executes -> stdout: "Context: What is the..."  │
  │ No FINAL() found -> continue                        │
  └─────────────────────────────────────────────────────┘
                         |
                         v
  ┌─────────────────────────────────────────────────────┐
  │ Iteration 2                                         │
  │                                                     │
  │ LLM response:                                       │
  │   "I see the question. Let me compute Fibonacci."   │
  │   ```repl                                           │
  │   fib = function(n) {                               │
  │       if (n <= 1) return n                          │
  │       return fib(n-1) + fib(n-2)                   │
  │   }                                                 │
  │   result = fib(15)                                  │
  │   console.log("Fibonacci(15) =", result)            │
  │   ```                                               │
  │                                                     │
  │ REPL executes -> stdout: "Fibonacci(15) = 610"      │
  │ No FINAL() found -> continue                        │
  └─────────────────────────────────────────────────────┘
                         |
                         v
  ┌─────────────────────────────────────────────────────┐
  │ Iteration 3                                         │
  │                                                     │
  │ LLM response:                                       │
  │   "The 15th Fibonacci number is 610."               │
  │   FINAL(The 15th Fibonacci number is 610)           │
  │                                                     │
  │ FINAL() detected -> return answer                   │
  └─────────────────────────────────────────────────────┘
                         |
                         v
              Output: "The 15th Fibonacci number is 610"
```

## Key Design Decisions

1. **Pure TypeScript / JavaScript** - No Python subprocess, no external dependencies.
   The REPL runs in-process using Node's `vm` module (`vm.createContext` /
   `vm.runInContext`) for sandboxed, isolated execution.

2. **vm Context persistence** - Variables assigned in one `executeCode()` call
   persist in subsequent calls through the shared `vm.Context` object. Bare
   assignments become properties on the context. Top-level `const`/`let`/`var`
   are preprocessed by `hoistDeclarations()` which strips the keyword, turning
   them into bare assignments that appear on the context object.

3. **Security via SANDBOX_GLOBALS whitelist** - The vm context only exposes
   explicitly whitelisted globals (`Math`, `JSON`, `Array`, `Promise`, etc.).
   `process`, `require`, `Bun`, `module`, `import()`, and all Node/Bun builtins
   are blocked. Code cannot escape the sandbox.

4. **Fake console injection** - `console` is placed directly on the vm context
   before each execution. `console.log()` captures output into `stdoutParts[]` /
   `stderrParts[]` for structured result reporting.

5. **LanguageModelV2 wrapping** - RLM appears as a standard Vercel AI SDK model.
   OpenCode's existing `streamText()` / `generateText()` calls work unchanged.
   The `doStream()` method runs `rlmCompletion()` internally and emits stream
   parts (reasoning for iterations, text for final answer).

6. **Config cascade** - RLM can be enabled globally (`opencode.json` -> `rlm.enabled`)
   or per-agent (`agent.rlm.enabled`). Agent config overrides global. Small model
   calls (title generation) always skip RLM.
