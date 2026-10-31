# Strobe benchmarks

These benchmarks run with [strobe](https://github.com/Hona/strobe). Each one compares two builds in pairs of fresh
launches (A B, B A, …) at normal speed and gives one verdict per case. They reuse the e2e mock server, so the web cases
need no real backend.

| File                      | Case                | Primary           | Workload                                                         |
| ------------------------- | ------------------- | ----------------- | ---------------------------------------------------------------- |
| `timeline.bench.ts`       | scroll history      | `main.busy`       | Scroll 4000 px up and back down through a 120-turn session.      |
|                           | type in composer    | `interaction.p95` | Type 42 characters, 80 ms apart, into the composer.              |
|                           | stream a reply      | `main.busy`       | Stream 40 markdown deltas into the last assistant message.       |
| `stream.bench.ts`         | stream a long reply | `main.work`       | Stream 240 markdown deltas (tables, code fences) at 80 a second. |
| `session-switch.bench.ts` | switch tab          | `main.work`       | Click between two tabs of 200 long markdown exchanges each.      |
| `desktop.bench.ts`        | idle                | `cpu.app.total`   | The packaged desktop app, every process, doing nothing for 5 s.  |

## Run

```sh
# Did my change help? Compare dev with this worktree.
strobe bench packages/app/perf/timeline.bench.ts --base origin/dev --head .

# One case only.
strobe bench packages/app/perf/timeline.bench.ts --base origin/dev --head . --filter "type*"

# Check the method on this machine: the same build on both sides must come out "same".
strobe bench packages/app/perf/timeline.bench.ts --aa --head .

# Two installed desktop channels.
strobe bench packages/app/perf/desktop.bench.ts --base app:opencode --head app:opencode-beta

# Open the interactive report.
strobe report experiment <exp_…> --open
```

## Why did it change?

`--why always` (or a verdict that moved, by default) adds one profiled launch per side after the timed pairs. The
report's lower half and these views read it; the result lists the recording ids:

```sh
strobe query <rec_…> hotspots          # CPU self time by function, with original file:line:column and full stacks
strobe query <rec_…> layout            # forced layouts and style recalcs, by the line that forced them
strobe query <rec_…> alloc             # bytes allocated by function, with stacks
strobe query <rec_…> gc                # collections and GC time per run
strobe query <rec_…> heap              # live objects by class, retained sizes, retainer paths
strobe query <base rec>..<head rec> heap   # which classes grew or shrank
```

Is something leaking? Three heap snapshots over a recording (start, middle, end); the suspects are objects from the
first half that are still alive at the end, with what keeps them alive:

```sh
strobe record app:opencode --probes memory --for 60s
strobe query <rec_…> leaks
```

Every timed pair also records `main.script`, `main.style` and `main.layout`, so "where main-thread time went" has
intervals too. Names and paths come from the build's source maps (`sourcemap: true` in the app's Vite config).

## Notes

- A variant is a directory or a git ref. A git ref becomes a detached worktree in strobe's own build folder.
- A locked screen pauses a bench: Chromium stops drawing behind the lock screen, so strobe waits for the unlock and
  runs the interrupted launch again.
- Strobe refuses invalid setups (a hidden window, a software GPU, a throttled CPU) instead of reporting numbers.
- Close heavy apps first. Background load widens the intervals but does not bias them.

## `strobe.json`

- `build` and `serve` are how strobe builds and serves the web app for each variant.
- `apps` are the desktop profiles. Strobe gives every launch a private home; a profile adds what the desktop needs on
  top, following `packages/desktop/script/bench-startup.ts`: its own database and config, a private service port, a
  file where the updater keeps its download cache (otherwise an older channel downloads the next release mid-run and
  looks like it idles at 10% CPU), the user's service registration as guarded state (strobe stops if it changes), and
  the `opencode://` key, which strobe saves and restores around each launch. The Dev channel has no profile on purpose. A source build is packed with
  `OPENCODE_CHANNEL=beta` or `prod` and passed as `exe:<path>`.

## Write a case

`prepare` runs in Playwright before the first page load and mocks the server under the variant's own origin. What it
returns is `prepared` in `setup`, `run` and `reset`, and `url` can name the first page from it. `run` is measured;
`reset` puts the state back between runs and is not. Do not throttle the CPU or network: make the workload bigger
instead.
