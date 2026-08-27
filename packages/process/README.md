# Local Process Package Experiment

Private and unpublished. This worktree consumes the package; the installed OpenCode server is unchanged.

The package owns the standard Effect `ChildProcessSpawner` implementation extracted from OpenCode, including stdin, pipelines, additional descriptors, cancellation, and reference control. Standard spawning retains its existing EOF behavior.

Native foreground capture supports Windows, absolute executable paths, ignored stdin, and separate pipe-backed stdout/stderr. No shell wrapper, PTY, output redirection in the child, or capture grace timer is used.

## OpenCode Integration

- `ProcessSpawner.layer` supplies the existing Effect service, so ordinary subprocess callers keep their interfaces.
- `packages/util/src/effect/app-node-platform.ts` contains only application-layer registration. Process mechanics live in `packages/process`, not Util.
- Shell calls `ProcessSpawner.startForeground(command, environment.spawner)`. Only the local package spawner exposes native capture; custom or remote spawners keep control of their execution.
- POSIX and command shapes outside the native capture subset retain the standard spawner path. A missing or broken native binding on a supported path fails instead of silently restoring the hang.
- Session state, permissions, output files, retention, and notifications remain in OpenCode.

The worktree was created from freshly fetched `upstream/v2` at `e2d6c4bd4a`. The original proof in `happy-comet` was left intact. No package has been published.

Integration checks:

- Windows: 55 package tests and 104 focused Core checks passed; 53 platform-specific Core cases were skipped. The Core checks include rejection of local execution when the environment has no execution plane.
- Linux under WSL, Bun 1.4.0: 36 package spawner tests and 69 focused Core tests passed, including descriptor pipelines and cancellation escalation.
- Process, Util, Core, CLI, and Server typechecks passed. The workerd bundle probe and profile boot test passed.
- The CLI standalone readiness test timed out in both this worktree and the original `happy-comet` worktree. It remains a separate verification limitation.
- Linux Bun 1.3.13 fails the sparse-FD pipeline test in both implementations; Bun 1.4.0 passes it. The test was not skipped or weakened.

## Consumer API

For collected output, pass one command:

```ts
const capture = Effect.gen(function* () {
  const result = yield* ForegroundProcess.run({
    executable: powershell,
    args: ["-NoProfile", "-NonInteractive", "-Command", "Write-Output hello"],
  })

  return result // exitCode, stdout, stderr
})
```

For streaming output, use `start(command)` inside an Effect scope. Its handle exposes `pid`, `exitCode`, `stdout`, `stderr`, combined `output`, and `terminate()`. Scope release terminates a still-running process before closing its capture. Use one consumer per channel: do not consume `output` alongside `stdout` or `stderr`.

Combined `output` supports one subscription. Its merge can read ahead, so cancelling that subscription is not a resumable pause. A second subscription fails explicitly rather than returning a silently incomplete remainder.

`run` collects into memory without truncation. Use the streams for large or unbounded output. Bytes are not decoded by this package. A nonzero exit code is a result, not a launch error.

## Invariants

- Exit observation is installed before acquisition can release the process, including in an already-closed scope.
- Only the native capture reads the OS pipes. There is no hidden runtime reader to race against.
- After foreground exit is observed, each reader reconciles its pending read, measures queued bytes once, and drains at most that remainder without waiting for new output.
- A read that completes successfully while cancellation is requested is retained.
- The final drain is nonblocking. Cancelling a pending descendant write can shrink the queued byte count; a stale count must never make the parent wait for new output.
- `exitCode` observes the process only. `run` also waits for both output streams before releasing capture resources.
- Interrupting a direct `stdout` or `stderr` subscriber does not forget its outstanding native read. A subsequent subscriber can receive that pending result. This is not replay of output already delivered to a stream consumer.
- Capture failures are not reported as complete output. Tree-termination failures are not silently converted into parent-only success.
- Native callbacks and OS resources have one lifetime owner. The backend does not use host libuv APIs or private Bun structures.
- Read ownership is committed before resolving a JavaScript promise, because promise resolution can synchronously re-enter the native API through a `then` getter.

## Explicit Limits

The cutoff occurs after exit observation and read reconciliation, separately for each channel. It is not an atomic snapshot at the exact OS exit timestamp, and pipes cannot identify which descendant wrote each byte.

Closing capture at that cutoff makes later descendant writes fail with `EPIPE`. The tests prove this behavior; they do not hide it or call it full EOF compatibility. Use the standard spawner for commands requiring later descendant output.

`terminate()` uses Windows `taskkill /T /F` while the foreground process is running. A failed tree termination remains a failure, even if emergency parent cleanup succeeds. This is not containment of detached or escaped processes. Worker teardown closes the native resources and terminates the foreground process; it does not promise descendant-tree containment.

Explicit `terminate()` reports typed errors. Effect scope finalizers cannot return typed failures, so termination or close failures during scope release become defects instead of being discarded.

Omitted `cwd` inherits the current directory. Omitted `env` inherits the current environment; an explicit `env` replaces it, and entries with `undefined` values are omitted. The Windows backend retains the required system variables used by the existing spawn behavior even with `env: {}`.

## Local Build

Requirements: Windows, Zig with C++ support, Node-API headers, Bun, and Node. Tests also require PowerShell 7.

From this package directory:

```powershell
bun run build:native C:/tmp/opencode/node-v24.14.1/include/node
bun typecheck
bun run test
bun run test:node
bun run demo
bun example/retained-writer.ts
```

The header path is a local build input, not a runtime dependency. Native build products are ignored. Nothing is published or installed into the live OpenCode server.

The retained-writer example captures 1 MiB and the stderr tail, verifies that the descendant is still alive after capture finishes, and then terminates that test-owned descendant.

## Local Evidence

Validated on Windows x64 with Bun 1.4.0 and Node 24.14.1:

- Package tests cover encoding, pipe modes, environment inheritance, large output, retained writers, cancellation, closed scopes, interrupted readers, worker teardown, and reentrant promise resolution.
- A native fixture cancels a pending descendant write but keeps its pipe open. The earlier blocking-drain build fails this regression; the nonblocking drain passes.
- 153 real commands were compared against the standard spawner on each runtime, with no stdout, stderr, exit-code, or redirected-file differences in that matrix.
- 54 retained-handle stress cases passed on each runtime, including 16 MiB per channel and slow readers.
- An isolated real `Shell.Service` adapter passed six cases: nonzero exit, untouched OEM437 decoding, retained handles, timeout, removal, and scope disposal.
- The examples also run in compiled Bun executables with the native addon embedded.

This is local evidence, not a production release or a complete native audit. Native foreground capture on other operating systems, architectures, and runtime versions remains unverified. Release packaging is not established by the source-worktree experiment.
