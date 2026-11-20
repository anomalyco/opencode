# @opencode/codemode

- The language (compiler, VM, runtime, stdlib, snapshots, Effect driver) is the `psychoscript` package (https://github.com/anomalyco/psychoscript). Language changes go there, get published, and are then bumped here. `src/codemode/` is Code Mode, built on it (tools, schemas, catalog, `search`, `scanTools`, OpenAPI, hooks, `maxToolCalls`): it gives programs its functions through `Host` and `Runtime.make`, and imports only `psychoscript`'s package entry (`test/language-boundary.test.ts`).
