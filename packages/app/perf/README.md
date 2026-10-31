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
main thread's split into script, style and layout are reported beside it.

## Run

```sh
# Did my change help? Compare dev with this worktree.
strobe bench packages/app/perf/timeline.bench.ts --base origin/dev --head .

# One case, or one parameter value.
strobe bench packages/app/perf/tabs.bench.ts --base origin/dev --head . --filter "open an unvisited*"
strobe bench packages/app/perf/home.bench.ts --base origin/dev --head . --params sessions=10000

# Is the method sound on this machine? The same build on both sides must come out "same".
strobe bench packages/app/perf/timeline.bench.ts --aa --head .

# Two installed desktop channels.
strobe bench packages/app/perf/desktop.bench.ts --base app:opencode --head app:opencode-beta

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
- `run` is measured; `reset` puts the state back between runs and is not. A case that should pay a first visit every
  run reloads in `reset`.
- End a run on what a person waits for: a selector that is visible (strobe ignores `visibility: hidden` and
  `opacity: 0`), with `>>>` to reach into a shadow root such as the diff viewer's. End with `page.idle()` when work
  continues after the last change on screen.
- Deliver events with `eventSource` (`fixtures/events.ts`): a real SSE endpoint whose pace never depends on the
  renderer, so delivery costs the page nothing.
- Do not throttle the CPU or the network: make the workload bigger instead.
- Fixtures shared with the e2e suites live in `e2e/utils`; ones only benchmarks use live in `fixtures/`, which
  `bun run typecheck:e2e` checks.

## `strobe.json`

- `build` and `serve` are how strobe builds and serves the web app for each variant. A variant is a directory or a
  git ref; a git ref becomes a detached worktree in strobe's own build folder.
- `apps` are the desktop profiles. Strobe gives every launch a private home; a profile adds what the desktop needs on
  top: its own database and config, a private service port, a file where the updater keeps its download cache
  (otherwise an older channel downloads the next release mid-run and looks like it idles at 10% CPU), the user's
  service registration as guarded state (strobe stops if it changes), and the `opencode://` key, which strobe saves
  and restores around each launch. The Dev channel has no profile on purpose. A source build is packed with
  `OPENCODE_CHANNEL=beta` or `prod` and passed as `exe:<path>`.

## Not here yet

- **Startup.** Strobe measures steady-state work in an already launched app. Packaged cold start stays with
  `packages/desktop/script/bench-startup.ts` (`bun run bench:startup`), and the dev desktop's start with
  `bun run bench:devex`, until strobe can time a launch.
- **Layout continuity.** No blank frames, jumps or replaced rows under stress is a correctness contract, owned by the
  regression suites and by `e2e/stability` (`bun run test:stability`), not a benchmark.
