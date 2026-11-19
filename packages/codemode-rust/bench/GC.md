# Automatic memory management

A run frees what it can no longer reach while it runs. Before, a run kept everything until it ended. That suited a
reducer event, but it killed a long-lived plugin loop: a palette-style loop died at its 2M-object limit after about
6,000 events.

## Design

`crates/psychoscript/src/collector.rs` is an incremental, non-moving mark-sweep collector, in the style of Lua 5.1
and gc-arena.

- **What it frees:** objects, closure cells, strings and atoms. A freed slot goes on a free list for the next
  allocation. Ids never move.
- **When it starts:** a run that never reaches its first threshold (64k slots in use) does no collection work at all.
  After a cycle, the next one starts at the live count plus max(live, 64k).
- **Pacing:** work is paid by allocation debt, in steps of bounded size. A run that doesn't allocate does nothing, so
  an idle run costs nothing. There are no threads and no timers.
- **Where it runs:** only at safe points, where every live value is in the VM's own structures:
  - loop back-edges of the outermost run;
  - job boundaries;
  - the stop for the host.

  It never runs inside a nested Rust→VM call or a conversion replay.
- **Marking is snapshot-at-the-beginning.**
  - The roots are scanned once, at cycle start.
  - While a cycle marks, the first write to an object that isn't yet black traces it first. That is one branch in
    `Heap`'s `IndexMut`, which every heap write goes through.
  - Overwriting a cell shades the old value. Everything allocated during a cycle is black.
  - Marking ends when nothing is grey; there is no atomic rescan.
  - Properties, elements and Map entries are traced 4,096 slots at a time, so one step stays short whatever an
    object's size.
- **Atoms:** an atom lives exactly as long as its own string. Atoms of the fresh runtime and of the compiled program
  are permanent.
  - Map and Set keep a string key as its atom's string, so tracing an entry keeps the atom alive.
  - An interner lookup during a cycle shades the atom it finds.
  - `JSON.stringify` keeps the keys it holds as strings.
  - A freed atom's id is reused, and snapshots save it as a hole at its exact id.
- **Map and Set:** a delete compacts the entries once deleted ones outnumber the live ones (and 32). Iterators and
  `forEach` hold logical positions, which compaction keeps (`OrderedMap::next_entry`).
- **Roots:** `reach.rs` enumerates every reference the VM holds, roots (`roots`) and objects' children (`head`,
  `bulk`). Snapshots and the collector share it.
- **Snapshots:** the format keeps its shape.
  - A freed slot saves as an empty placeholder, which the resumed run frees in its first cycle.
  - A freed atom saves as `null`.
  - Map and Set entries save with their logical positions.
- **Stress mode:** `PSYCHOSCRIPT_GC_STRESS=1` collects at every safe point, in tiny steps.

Still unbounded:
- A single macOS `free()` during a sweep step can take about 1 ms; see the large live set below.
- The barrier traces one huge object in a single go: about 0.8 ms for 2M slots.
- WeakMap and WeakSet hold their entries strongly, as in the reference.

## Method

- **Machine:** Apple M5 Max, 18 cores, 48 GiB, macOS 26.7.1; rustc 1.100.0, release profile.
- **Comparison:** the collector, against its parent commit without it.
- **Throughput:** `psychoscript-bench --iterations 21 --json`.
  - It reports the median instructions retired per run of each of the nine programs (`proc_pid_rusage`,
    `bench/src/counters.rs`), and the median wall time.
  - Instruction counts are the comparison.
  - Tool fan-out and promise fan-out vary by up to ±5% between runs of the same binary.
- **Plugin event:** `psychoscript-bench --plugin --runs 3000 bench/plugin/reducer.js bench/plugin/reducer-padded.js`,
  five alternating runs of each binary, median of their mean instructions per `execute`.
- **Long-lived runs:** `cargo build --release -p psychoscript-bench --features gc-stats --example gc_bench`, then:
  - `gc_bench all --events 20000 --frames 4000`;
  - `gc_bench loop palette --events 100000`;
  - `gc_bench loop large --events 20000`.
- **What gc_bench does:** it drives each program in `bench/gc/` as a future on one thread, looping on
  `await nextEvent()` as an OpenTUI plugin does. It reports:
  - event (or frame) latency;
  - live and peak bytes, from a counting allocator;
  - the process footprint;
  - each run's live and peak slots, and each collection step's duration (`Run::heap_stats`, `gc-stats` builds only).
- **Correctness:** these all pass:
  - `cargo test --workspace`, plain and with `PSYCHOSCRIPT_GC_STRESS=1`;
  - the conformance cases in round-trip mode, alone and together with stress;
  - test262;
  - `gc_bench` under stress, whose results and rendered output equal a normal run's.

## Results

Plugin event (instructions per `execute`):

| Source | No collector | Collector |
|---|---:|---:|
| reducer.js | 495k | 497k (+0.4%) |
| reducer.js, compiled | 409k | 410k (+0.2%) |
| reducer-padded.js | 1,106k | 1,109k (+0.2%) |
| reducer-padded.js, compiled | 429k | 430k (+0.2%) |

Nine programs (median instructions per run, median ms):

| Program | No collector | Collector |
|---|---:|---:|
| numeric-loop | 108.8M, 4.3 ms | 108.8M (+0.0%), 3.9 ms |
| closure-recursion | 39.6M, 1.4 ms | 39.6M (+0.0%), 1.4 ms |
| array-callbacks | 288.6M, 9.8 ms | 288.2M (-0.1%), 9.8 ms |
| promise-fan-out | 24.3M, 0.8 ms | 24.5M (+1.1%), 1.0 ms |
| tool-fan-out | 11.9M, 0.4 ms | 11.5M (-3.2%), 0.4 ms |
| json-round-trip | 310.9M, 10.7 ms | 316.6M (+1.8%), 11.0 ms |
| generator-iteration | 36.8M, 1.1 ms | 37.3M (+1.1%), 1.1 ms |
| string-building | 95.7M, 2.7 ms | 97.4M (+1.7%), 2.8 ms |
| map-set-ops | 106.6M, 4.3 ms | 108.9M (+2.1%), 4.3 ms |

Long-lived runs (20,000 events each):

| Scenario | Collector? | Events | Live KiB end / max | Peak footprint KiB | Event µs p50 / p99 / max | GC steps | GC ms | Pause µs p50 / p99 / max |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| palette | off | 6,252 † | 159 / 475,142 | 417,648 | 111 / 169 / 595 | 0 | 0.0 | – |
| palette | on | 20,000 | 16,561 / 20,683 | 25,696 | 109 / 252 / 698 | 3,259 | 137.2 | 46 / 76 / 101 |
| growing | off | 20,000 | 184,041 / 184,041 | 159,568 | 4 / 8 / 224 | 0 | 0.0 | – |
| growing | on | 20,000 | 14,797 / 16,054 | 22,656 | 4 / 40 / 135 | 488 | 16.0 | 31 / 76 / 128 |
| map-churn | off | 20,000 | 188,044 / 188,044 | 188,992 | 6 / 16 / 2,143 | 0 | 0.0 | – |
| map-churn | on | 20,000 | 16,853 / 17,503 | 26,144 | 6 / 43 / 298 | 578 | 16.8 | 26 / 55 / 101 |
| strings | off | 17,094 † | 158 / 312,572 | 295,808 | 11 / 23 / 235 | 0 | 0.0 | – |
| strings | on | 20,000 | 6,978 / 8,157 | 9,952 | 10 / 43 / 78 | 810 | 19.0 | 26 / 50 / 59 |
| closures | off | 20,000 | 196,442 / 196,442 | 148,544 | 5 / 12 / 255 | 0 | 0.0 | – |
| closures | on | 20,000 | 10,526 / 12,243 | 14,016 | 5 / 43 / 99 | 602 | 18.2 | 37 / 53 / 66 |
| generators | off | 16,804 † | 159 / 432,336 | 418,512 | 8 / 20 / 248 | 0 | 0.0 | – |
| generators | on | 20,000 | 15,887 / 19,342 | 18,240 | 8 / 38 / 113 | 1,466 | 37.7 | 27 / 40 / 51 |

50 heaps, 5 active, 4,000 frames:

| Collector? | Frames | Live KiB setup / end | Peak footprint KiB | Frame µs p50 / p99 / max | GC steps (idle) | GC ms | Pause µs p50 / p99 / max |
|---|---:|---:|---:|---:|---:|---:|---:|
| off | 4,000 | 8,807 / 548,069 | 417,280 | 142 / 208 / 957 | 0 (0) | 0.0 | – |
| on | 4,000 | 8,822 / 67,426 | 76,096 | 138 / 317 / 414 | 1,059 (0) | 47.6 | 43 / 117 / 190 |

Palette, 100,000 events:

| Collector? | Events | Live KiB end / max | Peak footprint KiB | Event µs p50 / p99 / max | GC steps | GC ms | Pause µs p50 / p99 / max | Objects live / peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| off | 6,252 † | 784 / 475,767 | 413,904 | 112 / 168 / 396 | 0 | 0.0 | – | 2,000,001 / 2,000,001 |
| on | 100,000 | 15,902 / 21,308 | 26,784 | 108 / 248 / 538 | 16,369 | 666.6 | 44 / 73 / 124 | 13,040 / 66,457 |

A large live set (about 600k objects and strings), 20,000 events:

| Collector? | Events | Live KiB end / max | Peak footprint KiB | Event µs p50 / p99 / max | GC steps | GC ms | Pause µs p50 / p99 / max | Objects live / peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| off | 6,273 † | 159 / 459,325 | 440,096 | 23 / 38 / 183 | 0 | 0.0 | – | 2,000,001 / 2,000,001 |
| on | 20,000 | 166,351 / 184,787 | 183,616 | 20 / 101 / 1,125 | 2,705 | 131.4 | 37 / 93 / 1,104 | 622,840 / 778,134 |

† The run failed at its memory limit after that many events.

Notes:
- Collection steps take 25–45 µs at p50, and stay under 120 µs at p99 everywhere.
- The 1.1 ms maximum on the large live set is a single macOS `free()` inside a sweep step; a program without the VM
  shows the same stalls.
- Live memory in the small programs is mostly the 64k-slot first threshold.

## Trials

Three collectors were trialled side by side behind cargo features. Each branch remains as the record.

- **`rust-gc-incremental`:** this design.
- **`rust-gc-sticky`:** non-moving generational collection with sticky mark bits. It kept the least memory, but its
  full collections stop the world: 16 ms with a 600k live set. It cost up to +5% instructions.
- **`rust-gc-nursery`:** a moving nursery that rewrites `u32` handles. Rewriting cost only 2–3 ns per survivor, but
  its full compactions stop the world: 17 ms with a 600k live set.

Reference counting was ruled out:
- `Value` is `Copy` throughout the VM.
- A barrier hooked on mutable access never sees the old value of a heap write.
- Cycles would need a backup trace anyway.
