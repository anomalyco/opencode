# Benchmarks

The app's benchmarks run with [strobe](https://github.com/Hona/strobe). Each compares two builds in pairs of fresh
launches (A B, B A, …) at normal speed, decides one primary metric per case with an interval, and refuses setups it
cannot defend (a hidden window, a software GPU, a throttled CPU, a busy machine). The web cases run the production
build on the e2e mock server, so they need no backend.

| File                  | Cases                                                                                                                                                                                         | Workload                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `timeline.bench.ts`   | scroll history · type in composer · find in session · expand an edit                                                                                                                          | A 120-turn session of markdown, code, tools and diffs.             |
| `stream.bench.ts`     | stream a reply · into a tool-heavy history · with review open                                                                                                                                 | 160 markdown deltas at 40 a second from a server that never waits. |
| `tabs.bench.ts`       | switch tab (warm, review open, after a resize, 1,200 models) · open an unvisited tab (± review)                                                                                               | Two tabs of 200 long markdown exchanges each, loaded in full.      |
| `navigation.bench.ts` | Home → session · close the last tab · new session (Home, titlebar) · new session page in and out · child session · restore 8 tabs · activate a restored tab · command palette (session, Home) | The stress fixture, paginated, from a fresh document every run.    |
| `home.bench.ts`       | load home · update a session in the background                                                                                                                                                | 500, 5,000 and 10,000 root sessions across 12 folders.             |
| `review.bench.ts`     | open review · filter files · next file                                                                                                                                                        | 100 and 10,000 changed files of 100 lines each.                    |
| `diff.bench.ts`       | open a long diff · open a huge diff · return to a long diff                                                                                                                                   | A 1,559-line diff, highlighted; a 15,599-line one, plain.          |
| `composer.bench.ts`   | type in a large draft · move the cursor in it · recall a prompt from history                                                                                                                  | A 44,000-character saved draft; 100 prompts with screenshots.      |
| `desktop.bench.ts`    | idle                                                                                                                                                                                          | The packaged desktop app, every process, doing nothing for 5 s.    |

Every case decides `main.work` (renderer main-thread task time per run) unless it says otherwise: it is continuous,
while durations that end on a presented frame move in whole vsyncs. Durations, interaction latency, frames and the
main thread's split into script, style and layout are reported beside it, and some cases count what should not
happen, compared exactly:

| Count                                  | Case                              | Expected                            |
| -------------------------------------- | --------------------------------- | ----------------------------------- |
| `net.requests{/api/session/*/message}` | switch tab (warm)                 | 0: a cached transcript stays        |
| `net.requests{/api/session/*/message}` | restore 8 tabs                    | 1: only the active tab's            |
| `count.draft.encode`                   | type in a large draft             | about 25 for 51 keystrokes: batched |
| `count.draft.encode`                   | move the cursor in a large draft  | 0: a caret move saves no text       |
| `layout.shift`                         | switch tab, open an unvisited tab | 0: nothing on screen jumps          |

Other packages keep their benchmarks next to their code:

| File                                     | Cases                                                                                                                                        | Decides                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/desktop/perf/startup.bench.ts` | launch to Home · to a restored tab · with the service stopped · first launch · dev start to Home                                             | `launch.ready`, from process spawn |
| `packages/core/perf/location.bench.ts`   | load a location, cached and dropped · keep a location graph · keep a models.dev plugin instance                                              | `cpu.work`, `js.heap.retained`     |
| `packages/core/perf/snapshot.bench.ts`   | capture (nothing changed, a file edited or added, 100 edited) · list and diff 100 changed files · restore 100 files · agent step loop · pack | `run.duration`, with `count.git`   |
| `packages/core/perf/session.bench.ts`    | an agent session of 15 steps, snapshots on and off                                                                                           | `run.duration`                     |
| `packages/ui/perf/motion.bench.ts`       | 1,000 springs for 60 frames                                                                                                                  | `cpu.work`                         |

A script case loads the package's harness module (`location.ts`, `snapshot.ts`, `motion.ts`) in a fresh Bun process
per block and calls its exports. Both builds run the same harness: in a git ref's worktree strobe places this
checkout's copy, so its imports reach that build's code.

## Run

```sh
# Did my change help? Compare dev with this worktree.
strobe bench packages/app/perf/timeline.bench.ts --base origin/dev --head .

# Does the file still work after a change to the app? Each case once, pass or fail with a screenshot.
strobe bench packages/app/perf/tabs.bench.ts --check

# One case, one parameter value, or the whole sweep (Home and review run two sizes unless asked).
strobe bench packages/app/perf/tabs.bench.ts --base origin/dev --head . --filter "open an unvisited*"
strobe bench packages/app/perf/home.bench.ts --base origin/dev --head . --params sessions=5000
strobe bench packages/app/perf/review.bench.ts --base origin/dev --head . --params all

# Is the method sound on this machine? The same build on both sides must come out "same".
strobe bench packages/app/perf/timeline.bench.ts --aa --head .

# Two installed desktop channels, or the desktop's launch (packages/desktop/README.md).
strobe bench packages/app/perf/desktop.bench.ts --base app:opencode --head app:opencode-beta
strobe bench packages/desktop/perf/startup.bench.ts --target desktop --base app:opencode --head app:opencode-beta

# Core and UI code, in a Bun process. The snapshot fixtures are generated once (a minute or two).
bun packages/core/perf/snapshot.ts medium opencode
strobe bench packages/core/perf/snapshot.bench.ts --base origin/dev --head .

# The interactive report.
strobe report experiment <exp_…> --open
```

Set `OPENCODE_PERF_SESSION` to a session export to add two cases to `tabs.bench.ts` on your own session: open it cold,
and switch to it warm.

## Why did it change?

A verdict that moved adds one profiled launch per side after the timed pairs (`--why always` forces it). The report's
lower half reads them, and so do these views:

```sh
strobe query <exp_…> insights             # what moved most between base and head, and what stands out in head
strobe query <rec_…> hotspots             # CPU self time by function, at the original file:line:column, with stacks
strobe query <rec_…> layout               # forced layouts and style recalculations, by the line that forced them
strobe query <rec_…> alloc                # bytes allocated by function
strobe query <rec_…> gc                   # collections and GC time per run
strobe query <rec_…> heap                 # live objects by class, retained sizes, retainer paths
strobe query <base rec>..<head rec> heap  # which classes grew or shrank
strobe query <rec_…> memory               # memory by process; --by layer or --by allocator for Chromium's accounting
strobe query <rec_…> shifts               # the largest layout shifts and the elements that moved
```

## Is something leaking?

A leak run repeats one case (10 runs to a middle snapshot, 10 more to the last) with a census after every run, and
says how much the JS heap and DOM grow per run, with an interval. It tells the app's objects from V8's compiled code,
which grows while the JIT warms up:

```sh
strobe bench packages/app/perf/tabs.bench.ts --filter "switch tab with a large model catalog" --head . --probes memory --repeat 10
strobe query <rec_…> leaks                            # objects from the first half still alive at the end, and what holds them
strobe record app:opencode --probes memory --for 60s  # the same over time, for an app left running
```

## Which commit moved it?

```sh
strobe bench packages/app/perf/timeline.bench.ts --filter "scroll*" --bisect <good>..<bad>
```

`--bisect` walks the first-parent line, one full experiment per step.

## Write a case

- A file's `prepare` runs in Playwright before the first page load and mocks the server under the variant's own
  origin (`new URL(url).origin`); `ctx.case` lets one file give each case its own fixture. What it returns is
  `prepared` in `setup`, `run` and `reset`.
- Mock on `cached(playwright.page, mock)` (`fixtures/mock.ts`), never on `playwright.page` itself: Playwright's routing
  turns the browser's HTTP cache off for the whole page, so every reload would refetch every script. `cached` answers
  the same routes through strobe's `mock`, which pauses only the API, and the e2e mock server runs on it unchanged.
- `run` is measured; `reset` puts the state back between runs and is not. A case that should pay a first visit every
  run reloads in `reset`; park the pointer with `page.hover(...)` afterwards, because the app prefetches a tab's
  transcript when the pointer rests on it, and the pointer stays where the last click left it.
- End a run on what a person waits for: a selector that is visible (strobe ignores `visibility: hidden` and
  `opacity: 0`) or `{ selector, text }`, with `>>>` to reach into a shadow root such as the diff viewer's. End with
  `page.idle()` when work continues after the last change on screen.
- Deliver events with `eventSource` (`fixtures/events.ts`): a real SSE endpoint whose pace never depends on the
  renderer, so delivery costs the page nothing. Stop it in the file's `teardown`.
- Count what should not happen with `metrics`: `net.requests{<path glob>}` for requests, `layout.shift`, and
  `count.<name>` from `ctx.count` or a counting init script (`countDraftEncodes` in `fixtures/composer.ts`). The app
  itself never counts for a benchmark.
- Do not throttle the CPU or the network: make the workload bigger instead. A parameter that sweeps sizes runs two by
  default (`{ run, more }`); `--params all` runs the curve.
- Fixtures shared with the e2e suites live in `e2e/utils`; ones only benchmarks use live in `fixtures/`.
  `bun run typecheck:e2e` checks both and every bench file, against `@hona/strobe-bench`'s types; strobe runs its
  own copy of that package. Validate a new or changed file with `--check` before a long run.

## `strobe.json`

- `build` and `serve` are how strobe builds and serves the web app for each variant. A variant is a directory or a
  git ref; a git ref becomes a detached worktree in strobe's own build folder.
- `apps` are the desktop profiles. Strobe gives every launch a private home; a profile adds what the desktop needs on
  top: its own database and config, a private service port, a file where the updater keeps its download cache
  (otherwise an older channel downloads the next release mid-run and looks like it idles at 10% CPU), the user's
  service registration as guarded state (strobe stops if it changes), and the `opencode://` key, which strobe saves
  and restores around each launch. The Dev channel has no profile on purpose. A source build is packed with
  `OPENCODE_CHANNEL=beta` or `prod` and passed as `exe:<path>`.

## Not benchmarks

- **Layout continuity.** No blank frames, jumps or replaced rows under stress is a correctness contract, owned by the
  regression suites and by `e2e/stability` (`bun run test:stability`), not a benchmark.
- **Snapshot robustness.** A zeroed index with a stale lock, concurrent captures from separate processes and a `..scope`
  folder are `packages/core/test/snapshot.test.ts`; packing keeps every object in `packages/core/test/git.test.ts`.
