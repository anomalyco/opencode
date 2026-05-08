# Investigation Techniques

Techniques for deeper investigation when standard code tracing is not enough. Load this when a bug does not reproduce reliably, involves timing or concurrency, or requires framework-specific tracing.

---

## Root-Cause Tracing

When a bug manifests deep in the call stack, the instinct is to fix where the error appears. That treats a symptom. Instead, trace backward through the call chain to find where the bad state originated.

**Backward tracing:**

- Start at the error
- At each level, ask: where did this value come from? Who called this function? What state was passed in?
- Keep going upstream until finding the point where valid state first became invalid — that is the root cause

**Worked example:**

```
Symptom: API returns 500 with "Cannot read property 'email' of undefined"
Where it crashes: sendWelcomeEmail(user.email) in NotificationService
Who called this? UserController.create() after saving the user record
What was passed? user = await UserRepo.create(params) — but create() returns undefined on duplicate key
Original cause: UserRepo.create() silently swallows duplicate key errors and returns undefined instead of throwing
```

The fix belongs at the origin (UserRepo.create should throw on duplicate key), not where the error appeared (NotificationService).

**When manual tracing stalls**, add instrumentation:

```
// Before the problematic operation
const stack = new Error().stack;
console.error('DEBUG [operation]:', { value, cwd: process.cwd(), stack });
```

Use `console.error()` in tests — logger output may be suppressed. Log before the dangerous operation, not after it fails.

---

## Multi-Component Boundary Instrumentation

Root-cause tracing walks one call chain. When a bug crosses subsystems — CI → build → signing, API → service → database, frontend → API → background worker — the failure localizes poorly to a single chain. Instead, instrument every component boundary in one run, capture what enters and what exits each, and let the evidence point to the failing layer.

**Shape:**

1. List the component boundaries data crosses from trigger to observed symptom.
2. At each boundary, log what enters and what exits — include the values, relevant environment, and a short tag identifying the boundary.
3. Run the scenario once.
4. Read the log linearly, comparing each "exits" value to the next "enters" value.
5. The boundary where data first stops matching expectation is the failing layer.

**Worked example (app signing on CI):**

```bash
# Layer 1: workflow env
echo "=== workflow env ==="
echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"

# Layer 2: build script env
echo "=== build script env ==="
echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"

# Layer 3: signing stage keychain state
echo "=== keychain ==="
security list-keychains
security find-identity -v

# Layer 4: the actual signing call
codesign --sign "$IDENTITY" --verbose=4 "$APP"
```

One run, and the log shows precisely which layer drops the value — secrets → workflow ✓, workflow → build ✗ → focus investigation on the workflow-to-build-script inheritance, not on signing.

**When this beats backward tracing:** When the symptom is far from the trigger (many components apart), when components are owned by different systems (CI vs app code), when the "call stack" is conceptual rather than literal (message bus, HTTP, process boundaries). Backward tracing still applies within each layer once the failing layer is identified.

---

## Git Bisect for Regressions

When a bug is a regression ("it worked before"), use binary search to find the breaking commit:

```bash
git bisect start
git bisect bad                    # current commit is broken
git bisect good <known-good-ref> # a commit where it worked
# git bisect will checkout a middle commit — test it
# mark as good or bad, repeat until the breaking commit is found
git bisect reset                  # return to original branch when done
```

For automated bisection with a test script:

```bash
git bisect start HEAD <known-good-ref>
git bisect run <test-command>
```

The test command should exit 0 for good, non-zero for bad.

---

## Intermittent Bug Techniques

When a bug does not reproduce reliably after 2-3 attempts:

**Logging traps.** Add targeted logging at the suspected failure point and run the scenario repeatedly. Capture the state that differs between passing and failing runs.

**Statistical reproduction.** Run the failing scenario in a loop to establish a reproduction rate:

```bash
for i in $(seq 1 20); do echo "Run $i:"; <test-command> && echo "PASS" || echo "FAIL"; done
```

A 5% reproduction rate confirms the bug exists but suggests timing or data sensitivity.

**Environment isolation.** Systematically eliminate variables:
- Same test, different machine?
- Same test, different data seed?
- Same test, serial vs parallel execution?
- Same test, with vs without network access?

**Data-dependent triggers.** If the bug only appears with certain data, identify the trigger condition:
- What is unique about the failing input?
- Does the input size, encoding, or edge value matter?
- Is the data order significant (sorted vs random)?

**Test-order pollution.** If an individual test passes in isolation but fails when the suite runs, tests are leaking state between each other:

- Run the failing test alone — if it passes, pollution is confirmed
- Run the failing test's file alone — narrows pollution to same-file or cross-file
- Run the suite with randomized test order (most runners support a seed flag) — a different failing-test neighbor each run implies global state mutation
- Bisect the preceding tests: run the failing test with just the first half of the earlier tests, then the second half, then narrow

Common culprits once isolated: module-level state, mocks not torn down, temp files not cleaned up, database rows not rolled back, environment variables mutated and not restored.

---

## Repro Minimization

Once a bug reproduces reliably, the reproduction is often large — a 500-line integration test, a huge payload, a lengthy form-filling sequence. A smaller reproduction makes every subsequent investigation step faster and localizes the actual trigger.

**Delta debugging (manual):**

1. Cut the reproduction in half.
2. Does it still fail? If yes, discard the other half; recurse on what remains. If no, the failing behavior depends on something in the half you cut — put it back and cut the other half instead.
3. Continue until no further reduction is possible without losing the failure.

**For input payloads:**

- Remove fields one at a time (or half at a time) while confirming the bug persists
- Shrink string values until the minimum length that still triggers the bug
- Replace complex nested structures with the smallest shape that reproduces

**For test sequences:**

- Remove setup steps that don't appear to affect the failing assertion
- Inline helpers into the test to see what actually runs
- Remove other assertions to isolate which one fails and on what state

The minimized repro often reveals the root cause directly — "the bug only triggers when the string contains a tab character" is a much louder signal than "the bug triggers in this 500-line integration test."

---

## Framework-Specific Debugging

### Rails
- Check callbacks: `before_save`, `after_commit`, `around_action` — these execute implicitly and can alter state
- Check middleware chain: `rake middleware` lists the full stack
- Check Active Record query generation: `.to_sql` on any relation
- Use `Rails.logger.debug` with tagged logging for request tracing

### Node.js
- Async stack traces: run with `--async-stack-traces` flag for full async call chains
- Unhandled rejections: check for missing `.catch()` or `await` on promises
- Event loop delays: `process.hrtime()` before and after suspect operations
- Memory leaks: `--inspect` flag + Chrome DevTools heap snapshots

### Python
- Traceback enrichment: `traceback.print_exc()` in except blocks
- `pdb.set_trace()` or `breakpoint()` for interactive debugging
- `sys.settrace()` for execution tracing
- `logging.basicConfig(level=logging.DEBUG)` for verbose output

---

## Stepping Debugger vs Instrumentation

Print-debugging is the default reach — it is fast to add and scales across many cases. But there are cases where an interactive stepping debugger converges to the root cause far faster. The rule of thumb:

- **Reach for a stepping debugger when:** the failing code path is localized (a specific function or tight call chain), the bug is reliably reproducible, and you need precise state at a known point — values of many locals at once, the exact shape of a structure, or the progression of state across a loop. One break, inspect everything.
- **Reach for instrumentation when:** the bug is intermittent, spans many calls or distributed components, or happens in a context where breaking execution is disruptive (production, concurrent code whose timing matters, long-running processes). Instrumentation captures diffuse behavior across time and environments.

Mixed use is common: instrument first to localize, then attach a debugger at the localized point.

**Entry points by language:**

| Language | Interactive breakpoint | Attach to running process |
|----------|------------------------|---------------------------|
| Python | `breakpoint()` in code, or `python -m pdb script.py` | `python -m pdb -p <pid>` (Python 3.14+ only); on earlier versions, instrument the target with `rpdb` / `remote-pdb` and connect after it triggers |
| Node.js | `debugger;` in code + `node --inspect-brk`, then connect via Chrome DevTools or VS Code | `kill -SIGUSR1 <pid>` to enable the inspector on the running process (Linux/macOS), then connect Chrome DevTools or VS Code to the default port 9229 |
| Ruby | `binding.irb` (stdlib), `binding.pry` (pry gem), `debugger` (debug gem), `rdbg` | `rdbg --attach <pid>` with `debug` gem loaded |
| Go | `dlv debug` or `dlv test`, then `break`, `continue`, `print` | `dlv attach <pid>` |
| Rust / C / C++ | `lldb target/debug/binary` or `gdb binary`, then `break`, `run`, `print` | `lldb -p <pid>` / `gdb -p <pid>` |
| Browser JS | `debugger;` in code, or DevTools Sources → set breakpoint | DevTools attaches to page automatically |

For test runs, most test runners integrate with the above — e.g., `node --inspect-brk $(which jest)`, `pytest --pdb`, `rspec` with `binding.pry`, `dlv test`. Prefer the runner's integration over trying to attach post-hoc.

---

## Race Condition Investigation

When timing or concurrency is suspected:

**Timing isolation.** Add deliberate delays at suspect points to widen the race window and make it reproducible:

```
// Simulate slow operation to expose race
await new Promise(r => setTimeout(r, 100));
```

**Shared mutable state.** Search for variables, caches, or database rows accessed by multiple threads or processes without synchronization. Common patterns:
- Global or module-level mutable state
- Cache reads without locks
- Database rows read then updated without optimistic locking

**Async ordering.** Check whether operations assume a specific execution order that is not guaranteed:
- Promise.all with dependent operations
- Event handlers that assume emission order
- Database writes that assume read consistency

**Condition-based waits instead of arbitrary delays.** Flaky tests are often built on `setTimeout`/`sleep` calls that guess at how long an operation takes. These pass on fast machines and fail under load or in CI. Replace the guess with polling the condition the test actually depends on, bounded by a timeout:

```typescript
// before: races under load
await new Promise(r => setTimeout(r, 50));
expect(getResult()).toBeDefined();

// after: waits for the condition
await waitFor(() => getResult() !== undefined, 'result available', 5000);
expect(getResult()).toBeDefined();
```

Arbitrary delays remain correct only when testing actual timing behavior (debounce intervals, throttle windows) — in that case, comment why the specific duration is needed.

---

## Heisenbugs and the Observer Effect

When adding `console.log`, attaching a debugger, or inserting instrumentation causes the bug to disappear, the observation is changing the system's behavior. That is itself diagnostic — do not conclude "fixed." The bug is still present; your instrumentation perturbed it out of sight.

**What the disappearance tells you:**

- **Timing-sensitive:** Instrumentation slowed the code enough that a race condition no longer wins. Investigate concurrency, async ordering, and shared mutable state rather than the nominal logic.
- **Garbage-collection-sensitive:** Logging allocated memory and triggered a GC that hid the symptom. Look at memory pressure, finalizers, object lifecycle.
- **Optimization-dependent:** Instrumentation prevented a compiler/JIT optimization that was producing wrong results. Rare but real (especially in C/C++/Rust release builds).
- **Buffering-dependent:** Log flushing changed I/O ordering. Often indicates unflushed writes elsewhere.
- **Async-ordering-sensitive:** Log I/O introduced a microtask boundary that reorders subsequent operations. Look for code that implicitly depends on synchronous ordering.

**How to investigate without perturbing:**

- Non-blocking instrumentation: write to a ring buffer in memory, dump it only after failure is observed
- Sampling profilers instead of tracing: external observation of what's running without injecting code into the path
- Platform-level instrumentation: `strace`, `dtrace`, eBPF, platform profilers that don't require code changes
- Post-mortem evidence: core dumps, heap snapshots, captured state from after the failure, without observing during

The defining rule: if the bug is sensitive to observation, the fix must survive re-introduction of the observation. A fix that only works while instrumentation is present is itself a heisenbug.

---

## Browser Debugging

When investigating UI bugs with `agent-browser` or equivalent tools:

```bash
# Open the affected page
agent-browser open http://localhost:${PORT:-3000}/affected/route

# Capture current state
agent-browser snapshot -i

# Interact with the page
agent-browser click @ref          # click an element
agent-browser fill @ref "text"    # fill a form field
agent-browser snapshot -i         # capture state after interaction

# Save visual evidence
agent-browser screenshot bug-evidence.png
```

**Port detection:** Check project instruction files (`AGENTS.md`, `CLAUDE.md`) for port references, then `package.json` dev scripts, then `.env` files, falling back to `3000`.

**Console errors:** Check browser console output for JavaScript errors, failed network requests, and CORS issues. These often reveal the root cause of UI bugs before any code tracing is needed.

**Network tab:** Check for failed API requests, unexpected response codes, or missing CORS headers. A 422 or 500 response from the backend narrows the investigation immediately.

---

## Evidence Harvesting Across Systems

When a bug spans a real environment — production, staging, a multi-service setup — the richest evidence usually already exists in logs, traces, and error-tracker payloads. Use it rather than reproducing from scratch when possible.

**Follow a single request end-to-end.** Pick one concrete failing request (an exact timestamp, user ID, or event ID from an error tracker). Then:

- Search every relevant log source for that identifier — correlation ID, request ID, trace ID, user ID
- Assemble the timeline in order: edge → API → service → database → downstream calls → response
- Note where the timeline has gaps (missing logs) or contradictions (timestamps out of order, IDs that don't propagate)

One traced request usually reveals the root cause faster than a dozen attempts to reproduce.

**Correlation IDs.** Most web frameworks either attach a request ID automatically or accept one via header (`X-Request-ID`, `traceparent`). When the project has one, every log line and every downstream call should carry it. If it's missing or not propagated, that is itself a finding — propagation gaps mean the agent cannot assemble the timeline, and neither could the on-call human who investigates the next incident.

**Timestamp triangulation.** When the failing operation has no shared ID, timestamps are the fallback. Constrain every log query to a narrow window around the observed failure, then look for the first anomaly in order. Watch for clock skew between services — a 30-second drift between two hosts reorders evidence and misleads triangulation.

**Error tracker payloads.** Sentry, Bugsnag, Honeybadger, AppSignal and similar tools capture stack traces, breadcrumbs, user context, request state, and release metadata at the moment of failure. Read the full payload before tracing code — it often contains the exact file:line, the variable state, and the breadcrumbs leading to the error. Grouping rules sometimes hide frequency and variant information; expand to see every instance rather than just the representative one.

**APM / distributed traces.** When the project has Datadog APM, Honeycomb, New Relic, or an OpenTelemetry collector, the trace view shows the full call tree across services with timings. Look for: unexpectedly long spans (blocking or slow dependency), failed spans in the middle of the chain, spans that should exist but don't (missing instrumentation also masks bugs).

**Preserve before investigating.** Error trackers and log systems have retention windows. Before starting a long investigation, export or snapshot the key evidence (event ID, trace ID, full stack trace, breadcrumbs) so it doesn't age out mid-session.

---

## System Boundary Checks

Many bugs live at the boundary between an application and the system it runs on — network, database, filesystem, OS. A fast pass through these boundaries often eliminates whole categories of suspicion before deep code tracing.

**Network.**

- DNS resolution: `dig <host>`, `nslookup <host>`, `host <host>` — does the name resolve to what you expect from this host?
- Reachability: `curl -v https://host/path` — full headers, redirects, TLS errors
- Status codes and headers: check response for 4xx/5xx, unexpected redirects, missing CORS headers, content-encoding surprises
- Connection state: `ss -tan` / `netstat -an` / `lsof -i` — open connections, listening ports, connections in TIME_WAIT or CLOSE_WAIT
- TLS: `openssl s_client -connect host:443` — certificate chain, expiry, SNI mismatches

**Database.**

- Query plan: `EXPLAIN` / `EXPLAIN ANALYZE` on the suspect query — is it using the expected index, or scanning a large table?
- Slow query log / recent queries: most databases surface the N slowest recent queries — failing queries often show up there
- Locks and transactions: inspect the lock/transaction tables (`pg_locks`, `information_schema.innodb_trx`, `sys.dm_tran_locks`) — is the operation waiting on a long-held lock?
- Connection pool: is the app exhausting its pool? Are connections leaking?
- Replication lag (if read replicas are in the path): a read right after a write may hit a replica that hasn't caught up yet

**Filesystem.**

- Existence and permissions: `ls -la <path>` — does the file exist, is it readable/writable by the running user?
- Case sensitivity: bugs that only appear on Linux (not macOS) are often case mismatches
- Open handles: `lsof <path>` or `lsof -p <pid>` — is something still holding the file, preventing write/unlink?
- Disk space: `df -h` — out-of-space errors sometimes surface as cryptic write failures elsewhere
- File watching / inotify limits: EMFILE or "too many open files" often means an inotify/FD limit, not a leak in your code
- Path separators and encoding: Windows-style paths in Unix code, or UTF-8 paths in a non-UTF-8 locale

**Processes and signals.** Check whether the process is actually the version you think is running (`ps aux | grep`, cross-reference pid to build time). Zombies, orphaned workers, and crashed-then-restarted-with-old-code processes all masquerade as code bugs.

---

## Bug-Class Pattern Checklist

Before deep tracing, run down this checklist. Many bugs match a recognizable class, and the class implies where to look first. Check whether the observed symptom fits any of these patterns:

- **Time and timezone:** off-by-hours errors near midnight, failures specifically during DST transitions, epoch/milliseconds confusion, naive vs timezone-aware datetimes mixed, UTC-vs-local assumed incorrectly
- **Encoding and locale:** mojibake in output, byte-vs-character length off-by-one, BOM at the start of a file breaking parsers, non-ASCII characters missing, locale-sensitive comparisons producing inconsistent results
- **Floating-point precision:** comparisons that "should" be equal but aren't, NaN propagating through a calculation and silently corrupting downstream results, very large or very small numbers losing precision
- **Integer overflow / underflow:** wraparound on bounded integer types, `int32` overflows in languages without arbitrary-precision integers, negative values where non-negative was assumed
- **Off-by-one and boundaries:** empty-collection edge case, first or last element missing, inclusive vs exclusive range mismatch, fencepost errors
- **Cache staleness:** correct behavior immediately after a change, wrong behavior after some time, fixed by restart or cache flush; includes HTTP caches, CDN caches, app-level memoization, browser service workers
- **Permissions / auth:** works for one user and not another, works in dev without auth layer but fails in prod with it, works with superuser but not with the actual operating identity
- **Dependency or version drift:** works on one machine but not another, lockfile out of sync with manifest, transitive dependency updated and changed behavior, native module built against a different runtime version
- **Path / case sensitivity:** works on macOS and fails on Linux (case), works on Linux and fails on Windows (path separators, reserved names like `CON`/`PRN`)
- **Concurrency / ordering:** works in serial test mode, fails in parallel; works one way and fails another when randomized
- **Stale build artifacts:** `dist/`, `.next/`, compiled `.pyc`, generated code, Docker image layers — rebuild from clean and see if it reproduces
- **Observer effect (heisenbug):** bug vanishes when logging, debugger, or profiler is attached — see the Heisenbugs section above
- **TOCTOU (time-of-check vs time-of-use):** a check passed a moment ago but the underlying state changed before the dependent action ran

Pattern-matching here is cheap. Spending 30 seconds checking whether the symptom fits a known class can eliminate hours of speculative tracing.
