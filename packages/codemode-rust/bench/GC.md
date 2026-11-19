# Automatic memory management: trials

Runs keep everything they allocate until they end. That suits a reducer event, but it kills a long-lived run: a
palette-style loop dies at its 2M-object limit after about 6,000 events. This file records the collectors trialled
for the Rust VM, how they were measured, and the results.

## Method

- **Machine:** Apple M5 Max, 18 cores, 48 GiB, macOS 26.7.1; rustc 1.100.0, release profile (thin LTO, one codegen
  unit).
- **Throughput:** `psychoscript-bench --iterations 21 --json`. The median instructions retired per run of each of the
  nine programs come from `proc_pid_rusage` (`bench/src/counters.rs`), with wall time alongside.
  - Instruction counts are the comparison. Wall times shared the machine with other work.
  - Tool fan-out and promise fan-out vary by up to ±6% between runs of the same binary: their host futures and timer
    thread count too.
- **Short runs:** `psychoscript-bench --plugin --runs 5000 bench/plugin/reducer.js bench/plugin/reducer-padded.js`:
  mean instructions and median µs per `execute`.
- **Long-lived runs:** `cargo build --release -p psychoscript-bench --features gc-stats,<collector> --example
  gc_bench`, then:
  - `gc_bench all --events 20000 --frames 4000`;
  - `gc_bench loop palette --events 100000`;
  - `gc_bench loop large --events 20000`.

  `gc_bench` drives each program in `bench/gc/` as a future on one thread. Each program loops on `await nextEvent()`,
  as an OpenTUI plugin does:
  - `palette`: filter 300 commands per event, keep only the selection.
  - `growing`: keep one record per event.
  - `map-churn`: a Map and a Set held near 2,000 entries.
  - `strings`: a few KB of text per event.
  - `closures`: handlers capturing per-event state.
  - `generators`: long-lived and per-event generators.
  - `large`: a live set of about 600k objects and strings, updated each event.
  - `many`: 50 runs of the six small programs. 45 stay idle and 5 get an event per frame.

  It reports:
  - per-event (or per-frame) latency;
  - live and peak bytes, from a counting global allocator;
  - the process's physical footprint;
  - the run's live and peak slots, and each collection step's duration (`Run::heap_stats`, `gc-stats` builds
    only);
  - for `many`, the collection steps taken by idle runs.
- **Correctness:** with each collector, all of these must pass:
  - `cargo test --workspace`;
  - the conformance cases plain, in round-trip mode (`PSYCHOSCRIPT_ROUNDTRIP=1`), with a collection at every safe
    point (`PSYCHOSCRIPT_GC_STRESS=1`), and both together;
  - `gc_bench` under stress, whose results and rendered output must equal a normal run's.

## Trials

Each trial sits behind a cargo feature on its own branch. With the feature off, instruction counts equal the base.

- **`gc-incremental`, branch `rust-gc-incremental`: non-moving incremental mark-sweep** (Lua 5.1, gc-arena).
  - Objects, closure cells and strings go on free lists when they die; ids never move.
  - Snapshot-at-the-beginning marking: while a cycle marks, the first write to an object that isn't yet scanned scans
    it first. Overwriting a cell shades the old value. Everything allocated during a cycle is black.
  - Roots are scanned once, at cycle start. Marking ends when nothing is grey, with no atomic re-trace.
  - Tracing and sweeping are counted in slots, and large objects are traced 4,096 slots at a time.
  - Pacing is by allocation debt. The first cycle starts at 64k slots in use, and the next at live + max(live, 64k).
- **`gc-sticky`, branch `rust-gc-sticky`: non-moving generational collection with sticky mark bits** (Demers et al.
  1990).
  - A minor collection sweeps only what was allocated since the last one. It uses the remembered set of written old
    objects.
  - A major collection is a stop-the-world mark-sweep, run when the old generation has doubled.
  - It also takes a minor collection when the run stops for the host.
- **`gc-nursery`, branch `rust-gc-nursery`: moving nursery.**
  - A minor collection slides the survivors of everything allocated since the last one down in place and rewrites
    every handle to them, using the remembered set of written old objects.
  - A full collection is a stop-the-world sliding compaction of the whole heap.
  - Cell slots on the stack are tagged so they can be found and rewritten.

Reference counting was not trialled:
- `Value` is `Copy` throughout the VM, and heap writes happen at about 400 sites. Their old values aren't available
  to a barrier hooked on mutable access.
- Coalescing those writes would mean logging an object's references on its first write each epoch, which copies a
  large array's whole contents.
- Cycles would still need a backup trace.

### Results

`incremental` is the trial after a second round. The first round used an incremental-update barrier with an atomic
rescan, and counted work per object rather than per slot. It reached +4.7% on numeric loop and +1.1% on the plugin
event, and its pauses peaked at 3.5 ms on `large`.

### Nine programs: median instructions per run (Δ vs baseline), median ms

| Program | baseline | incremental | sticky | nursery |
|---|---:|---:|---:|---:|
| numeric-loop | 108.8M, 4.1 ms | 108.8M (+0.0%), 4.1 ms | 114.2M (+4.9%), 4.2 ms | 110.6M (+1.6%), 4.2 ms |
| closure-recursion | 39.6M, 1.5 ms | 39.6M (+0.0%), 1.4 ms | 41.1M (+3.8%), 1.6 ms | 39.8M (+0.4%), 1.5 ms |
| array-callbacks | 288.6M, 9.8 ms | 288.2M (-0.1%), 9.9 ms | 298.3M (+3.4%), 11.1 ms | 289.4M (+0.3%), 10.5 ms |
| promise-fan-out | 24.3M, 0.8 ms | 24.5M (+1.1%), 0.9 ms | 25.0M (+2.9%), 0.9 ms | 24.4M (+0.6%), 0.9 ms |
| tool-fan-out | 11.5M, 0.4 ms | 11.9M (+3.5%), 0.4 ms | 12.2M (+6.1%), 0.4 ms | 12.1M (+4.8%), 0.4 ms |
| json-round-trip | 310.7M, 10.7 ms | 315.5M (+1.5%), 10.8 ms | 321.6M (+3.5%), 11.0 ms | 312.6M (+0.6%), 10.8 ms |
| generator-iteration | 36.9M, 1.1 ms | 37.2M (+1.1%), 1.1 ms | 38.7M (+5.0%), 1.1 ms | 37.5M (+1.6%), 1.3 ms |
| string-building | 95.7M, 2.7 ms | 96.9M (+1.2%), 2.9 ms | 97.6M (+2.0%), 2.8 ms | 96.8M (+1.1%), 3.0 ms |
| map-set-ops | 106.6M, 4.2 ms | 107.4M (+0.7%), 4.3 ms | 108.0M (+1.3%), 4.4 ms | 107.2M (+0.5%), 4.4 ms |

### Plugin event: instructions per execute (Δ), median µs

| Source | baseline | incremental | sticky | nursery |
|---|---:|---:|---:|---:|
| reducer.js | 492k, 21.8 µs | 495k (+0.5%), 21.7 µs | 501k (+1.8%), 21.2 µs | 494k (+0.3%), 21.3 µs |
| reducer-padded.js | 1106k, 44.7 µs | 1110k (+0.3%), 46.7 µs | 1116k (+0.9%), 45.0 µs | 1109k (+0.2%), 45.4 µs |

### Long-lived runs (20,000 events each)

| Scenario | Trial | Events | Live KiB end / max | Peak footprint KiB | Event µs p50 / p99 / max | GC steps | GC ms | Pause µs p50 / p99 / max |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| palette | baseline | 6,252 † | 159 / 475,142 | 413,888 | 112 / 168 / 629 | 0 | 0.0 | – |
| palette | incremental | 20,000 | 16,561 / 20,683 | 25,728 | 109 / 251 / 1,029 | 3,259 | 134.4 | 45 / 71 / 150 |
| palette | sticky | 20,000 | 7,770 / 7,814 | 11,952 | 107 / 213 / 796 | 2,488 | 131.7 | 52 / 69 / 685 |
| palette | nursery | 20,000 | 21,019 / 27,661 | 33,568 | 111 / 201 / 794 | 8,853 | 144.7 | 19 / 91 / 164 |
| growing | baseline | 20,000 | 184,040 / 184,040 | 159,568 | 4 / 9 / 218 | 0 | 0.0 | – |
| growing | incremental | 20,000 | 15,015 / 16,003 | 22,416 | 4 / 34 / 364 | 451 | 15.0 | 28 / 114 / 357 |
| growing | sticky | 20,000 | 11,183 / 11,211 | 16,592 | 4 / 36 / 1,056 | 395 | 13.6 | 32 / 47 / 912 |
| growing | nursery | 20,000 | 14,580 / 18,739 | 20,656 | 4 / 15 / 559 | 1,660 | 10.5 | 1 / 120 / 528 |
| map-churn | baseline | 20,000 | 188,044 / 188,044 | 189,008 | 6 / 14 / 2,126 | 0 | 0.0 | – |
| map-churn | incremental | 20,000 | 97,533 / 106,055 | 163,552 | 6 / 34 / 2,605 | 683 | 14.8 | 18 / 104 / 196 |
| map-churn | sticky | 20,000 | 107,597 / 117,151 | 177,120 | 7 / 123 / 4,664 | 290 | 58.3 | 159 / 1,000 / 4,657 |
| map-churn | nursery | 20,000 | 90,439 / 95,000 | 145,888 | 7 / 20 / 2,822 | 603 | 22.1 | 11 / 710 / 2,525 |
| strings | baseline | 17,094 † | 158 / 312,572 | 295,840 | 11 / 22 / 182 | 0 | 0.0 | – |
| strings | incremental | 20,000 | 6,978 / 8,157 | 9,856 | 10 / 43 / 98 | 810 | 18.5 | 25 / 47 / 71 |
| strings | sticky | 20,000 | 8,694 / 8,729 | 11,520 | 10 / 32 / 463 | 1,096 | 22.7 | 20 / 33 / 411 |
| strings | nursery | 20,000 | 9,405 / 16,197 | 12,672 | 10 / 22 / 138 | 4,826 | 14.0 | 2 / 25 / 58 |
| closures | baseline | 20,000 | 196,442 / 196,442 | 148,480 | 5 / 12 / 197 | 0 | 0.0 | – |
| closures | incremental | 20,000 | 10,526 / 12,243 | 14,064 | 5 / 38 / 86 | 602 | 16.6 | 32 / 44 / 56 |
| closures | sticky | 20,000 | 5,865 / 6,140 | 8,976 | 5 / 34 / 568 | 590 | 18.3 | 28 / 44 / 534 |
| closures | nursery | 20,000 | 9,546 / 18,982 | 16,304 | 5 / 25 / 122 | 738 | 14.3 | 19 / 50 / 101 |
| generators | baseline | 16,804 † | 159 / 432,336 | 418,544 | 8 / 19 / 259 | 0 | 0.0 | – |
| generators | incremental | 20,000 | 15,887 / 19,342 | 18,224 | 7 / 37 / 112 | 1,466 | 31.6 | 21 / 36 / 46 |
| generators | sticky | 20,000 | 6,991 / 7,090 | 10,640 | 8 / 51 / 572 | 822 | 36.4 | 43 / 58 / 544 |
| generators | nursery | 20,000 | 10,347 / 26,720 | 23,344 | 7 / 21 / 92 | 2,446 | 30.3 | 12 / 29 / 74 |

### 50 heaps, 5 active, 4,000 frames

| Trial | Frames | Live KiB setup / end | Peak footprint KiB | Frame µs p50 / p99 / max | GC steps (idle) | GC ms | Pause µs p50 / p99 / max |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 4,000 | 8,807 / 548,069 | 417,392 | 141 / 214 / 987 | 0 (0) | 0.0 | – |
| incremental | 4,000 | 8,821 / 80,683 | 90,608 | 139 / 308 / 769 | 1,086 (0) | 45.1 | 40 / 115 / 237 |
| sticky | 4,000 | 8,825 / 62,877 | 71,616 | 139 / 286 / 1,533 | 902 (0) | 46.8 | 52 / 83 / 1,223 |
| nursery | 4,000 | 8,821 / 79,554 | 100,624 | 146 / 268 / 1,131 | 2,853 (0) | 44.4 | 18 / 62 / 961 |

### Palette, 100,000 events

| Trial | Events | Live KiB end / max | Peak footprint KiB | Event µs p50 / p99 / max | GC steps | GC ms | Pause µs p50 / p99 / max | Objects live / peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 6,252 † | 784 / 475,767 | 413,840 | 112 / 169 / 432 | 0 | 0.0 | – | 2,000,001 / 2,000,001 |
| incremental | 100,000 | 15,901 / 21,308 | 26,320 | 109 / 251 / 396 | 16,369 | 662.7 | 44 / 70 / 137 | 13,040 / 66,457 |
| sticky | 100,000 | 8,768 / 9,245 | 12,880 | 108 / 214 / 956 | 12,488 | 660.7 | 52 / 70 / 844 | 12,014 / 32,833 |
| nursery | 100,000 | 26,979 / 34,873 | 57,248 | 117 / 226 / 1,028 | 41,458 | 786.0 | 20 / 109 / 716 | 81,696 / 98,747 |

### Large live set (about 600k objects and strings), 20,000 events

| Trial | Events | Live KiB end / max | Peak footprint KiB | Event µs p50 / p99 / max | GC steps | GC ms | Pause µs p50 / p99 / max | Objects live / peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 6,273 † | 159 / 459,325 | 440,032 | 22 / 37 / 204 | 0 | 0.0 | – | 2,000,001 / 2,000,001 |
| incremental | 20,000 | 176,678 / 183,914 | 182,112 | 21 / 110 / 1,141 | 2,516 | 130.2 | 41 / 105 / 1,119 | 701,890 / 769,974 |
| sticky | 20,000 | 148,418 / 148,557 | 215,792 | 25 / 63 / 16,250 | 2,257 | 100.2 | 32 / 142 / 16,219 | 990,196 / 991,529 |
| nursery | 20,000 | 136,273 / 185,336 | 206,192 | 24 / 53 / 17,074 | 5,304 | 127.5 | 11 / 234 / 17,043 | 694,931 / 839,146 |

† The run failed at its memory limit after that many events.

### Reading the results

- **Short runs.**
  - The plugin event costs +0.3% to +0.5% instructions under each collector, with wall time within noise. That is the
    floor for any barrier hooked on mutable heap access: about 760 checks per run.
  - No collector does any work in a reducer event, or in eight of the nine programs; JSON round-trip collects once.
- **Throughput.** Excluding tool fan-out, which is within its ±6% noise:
  - incremental stays within +1.5% on every program;
  - nursery within +1.6%;
  - sticky reaches +5.0%, mostly code layout around its heap wrapper.
- **Long-lived runs.** Every collector keeps every program alive. Live memory sits at the first threshold plus the
  live set.
  - Sticky keeps the least: its first threshold is half the others'.
  - Nursery keeps the most, because of lazy sweeping.
  - map-churn stays near 100 MB under all three: Map and Set string keys are interned as atoms, and no collector frees
    atoms.
- **Pauses.**
  - Minor and incremental steps take 20–50 µs at p50 and stay under 300 µs at p99.
  - The generational trials' full collections are stop-the-world and O(live): 16–17 ms with a 600k live set.
  - Incremental's worst step on `large`, 1.1 ms, is a single macOS `free()` during a sweep step. A program without
    the VM shows the same stalls. Its collector work per step stays near 300 µs.
- **Idle heaps.** Every collector took zero steps in the 45 idle runs, and none adds a thread.

## Recommendation: `gc-incremental`

It is the only design here whose pauses stay bounded as the live set grows, and its throughput is at least as good as
the others'.

- **Size:** 1,246 lines added, 74 removed. `src/gc_incremental.rs` is 923 lines, plus hooks in `vm.rs` (90),
  `strings.rs` (120), `reach.rs` (127), `program.rs`, `ops.rs`, `snapshot.rs` and `gc.rs`, and a regression test
  (`tests/gc.rs`).
- **Values:** `Value` and `Slot` are unchanged. Cells stay raw indices in stack slots, scanned conservatively: at worst
  a number keeps a dead cell.
- **Frames:**
  - Frames, saved frames, native frames' stacks and generators' saved stacks are traced from the roots.
  - A generator's frame lives in its object, so writes to it go through the barrier.
  - Collection happens only at safe points: back-edges of the outermost run, job boundaries, and the host stop. Never
    inside a nested Rust→VM call or a conversion replay.
- **Host values:** `HostValue` never holds VM ids. The host structures that do (calls, restarts, queued work,
  suggestions, unhandled rejections) are roots, listed once in `reach.rs`, which snapshots and the collector now
  share.
- **Snapshots:** the format is unchanged. A freed slot saves as an empty object, `""` or `undefined`. A resumed run
  starts with an idle collector, which frees those placeholders in its first cycle.
- **`Send`:** the collector's state is plain vectors, with no threads, no `unsafe` and no dependencies.

Still open:
- **Atoms are never freed**, which keeps map-churn near 100 MB. Four things block it:
  - the native `JSON.stringify` walk holds atoms across safe points;
  - the interner behaves like a weak table, so it would need a read barrier;
  - a Map's string keys exist only in its hash index;
  - snapshots save atoms by position.
- **`OrderedMap` never compacts its tombstones:** 400k entry slots for 2,000 live entries.
- **One barrier scan of a huge object is linear in its size:** about 0.8 ms for 2M slots.
- **WeakMap and WeakSet hold their entries strongly**, as the reference does.

## The reference language layer

The TypeScript reference makes program objects plain JavaScript objects, which the host engine collects. It keeps no
per-run object table. Its WeakMap and WeakSet are strong too. It needs no change.
