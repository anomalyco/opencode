#!/usr/bin/env bash
# Measures PsychoScript against the reference's language layer (`Runtime.make` from `src/language/` of the CodeMode
# package) and writes bench/RESULTS.md. Both sides run the programs with the same host global, the `tools` namespace
# of conformance/reference.ts and conformance/reference.rs.
# Usage: bash bench/compare.sh. The reference CodeMode package is ../codemode relative to this workspace; set
# CODEMODE_REF to another package directory to override it.
# Needs bun, cargo, jq, strip and /usr/bin/time; runs on Linux and macOS. Rust columns read "n/a" while the core cannot
# run a case.
# ITERATIONS (11), COLD_RUNS (20) and PLUGIN_RUNS (2000) scale the run; CI uses smaller values.
set -uo pipefail
[ -n "${CODEMODE_REF:-}" ] && CODEMODE_REF=$(cd "$CODEMODE_REF" && pwd)
cd "$(dirname "$0")/.."
REF_PKG=${CODEMODE_REF:-../codemode}
[ -f "$REF_PKG/src/language/index.ts" ] || { echo "reference CodeMode package not found at $REF_PKG" >&2; exit 1; }
ITERATIONS=${ITERATIONS:-11}
COLD_RUNS=${COLD_RUNS:-20}
PLUGIN_RUNS=${PLUGIN_RUNS:-2000}
OUT=bench/RESULTS.md
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

SLUGS=(numeric-loop closure-recursion array-callbacks promise-fan-out tool-fan-out json-round-trip generator-iteration string-building map-set-ops)
NAMES=("numeric loop" "closure recursion (fib 22)" "array callbacks (50k)" "promise fan-out (5k)" "tool fan-out (1k)" "JSON round-trip" "generator iteration" "string building" "Map/Set ops")
BENCH=target/release/psychoscript-bench
EMBED=target/release/examples/embed

median() { sort -g | awk '{ v[NR] = $1 } END { print v[int(NR / 2) + 1] }'; }
bytes() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }
fmt() { [ -n "$1" ] && printf '%.1f' "$1" || printf 'n/a'; }
ratio() { # numerator, denominator, [printf format]
  [ -n "$1" ] && [ -n "$2" ] && awk -v a="$1" -v b="$2" -v f="${3:-%.2f}" 'BEGIN { printf f, a / b }' || printf 'n/a'
}

echo "building release binaries" >&2
cargo build --release --locked -p psychoscript-bench --bin psychoscript-bench --example embed >&2 || echo "Rust build failed" >&2

# (a) Per-case median and min.
echo "(a) reference bench" >&2
bun bench/ref/bench.ts --iterations "$ITERATIONS" "${SLUGS[@]}" >"$TMP/ref-bench.txt" || echo "reference bench failed" >&2
ref_field() { # slug, field (median_ms or min_ms)
  grep -F "\"slug\":\"$1\"" "$TMP/ref-bench.txt" | jq -r ".$2 // empty"
}
TABLE_A="| Case | Reference median ms | Reference min ms | Rust median ms | Rust min ms | Median speedup |
|---|---:|---:|---:|---:|---:|"
for i in "${!SLUGS[@]}"; do
  slug=${SLUGS[$i]} name=${NAMES[$i]}
  echo "(a) rust $slug" >&2
  rm_med="" rm_min=""
  if [ -x "$BENCH" ] && "$BENCH" --filter "$slug" --iterations "$ITERATIONS" --json >"$TMP/rust-$slug.json" 2>/dev/null; then
    rm_med=$(jq '.[0].median_ms' "$TMP/rust-$slug.json") rm_min=$(jq '.[0].min_ms' "$TMP/rust-$slug.json")
  fi
  r_med=$(ref_field "$slug" median_ms) r_min=$(ref_field "$slug" min_ms)
  speedup=n/a
  [ -n "$rm_med" ] && [ -n "$r_med" ] && speedup=$(awk -v r="$r_med" -v s="$rm_med" 'BEGIN { printf "%.1fx", r / s }')
  [ "$slug" = tool-fan-out ] && name+=" ¹"
  TABLE_A+="
| $name | $(fmt "$r_med") | $(fmt "$r_min") | $(fmt "$rm_med") | $(fmt "$rm_min") | $speedup |"
done

# (e) Perturbed variants: each program and an equivalent, differently written one, on both sides in this run.
echo "(e) variants" >&2
bun bench/ref/variants.ts --iterations "$ITERATIONS" "${SLUGS[@]}" >"$TMP/ref-variants.txt" ||
  echo "reference variants failed" >&2
TABLE_E="| Case | Reference original median ms | Reference variant median ms | Reference variant / original | Rust original median ms | Rust variant median ms | Rust variant / original | Rust ratio / reference ratio |
|---|---:|---:|---:|---:|---:|---:|---:|"
for i in "${!SLUGS[@]}"; do
  slug=${SLUGS[$i]}
  echo "(e) rust $slug" >&2
  ref_line=$(grep -F "\"slug\":\"$slug\"" "$TMP/ref-variants.txt" || true)
  ro_med=$(jq -r '.original.median_ms // empty' <<<"$ref_line") rv_med=$(jq -r '.variant.median_ms // empty' <<<"$ref_line")
  so_med="" sv_med="" note=""
  if [ -x "$BENCH" ] &&
    "$BENCH" --filter "$slug" --iterations "$ITERATIONS" --json >"$TMP/orig-$slug.json" 2>/dev/null &&
    "$BENCH" --cases bench/variants --filter "$slug" --iterations "$ITERATIONS" --json >"$TMP/var-$slug.json" 2>/dev/null; then
    so_med=$(jq '.[0].median_ms' "$TMP/orig-$slug.json") sv_med=$(jq '.[0].median_ms' "$TMP/var-$slug.json")
    [ "$(jq -c '.[0].value' "$TMP/orig-$slug.json")" = "$(jq -c '.[0].value' "$TMP/var-$slug.json")" ] ||
      note=" (variant result differs)"
  fi
  r_ratio=$(ratio "$rv_med" "$ro_med") s_ratio=$(ratio "$sv_med" "$so_med")
  rel=n/a
  [ "$r_ratio" != n/a ] && [ "$s_ratio" != n/a ] && rel=$(ratio "$(ratio "$sv_med" "$so_med" %.6f)" "$(ratio "$rv_med" "$ro_med" %.6f)" '%.2fx')
  TABLE_E+="
| ${NAMES[$i]}$note | $(fmt "$ro_med") | $(fmt "$rv_med") | $r_ratio | $(fmt "$so_med") | $(fmt "$sv_med") | $s_ratio | $rel |"
done

# (f) Plugin event: the conformance reducer handling a git.status command, PLUGIN_RUNS warm-up then PLUGIN_RUNS timed.
echo "(f) plugin event" >&2
PLUGIN_SOURCES=(bench/plugin/reducer.js bench/plugin/reducer-padded.js)
bun bench/ref/plugin.ts --runs "$PLUGIN_RUNS" "${PLUGIN_SOURCES[@]}" >"$TMP/ref-plugin.txt" || echo "reference plugin failed" >&2
[ -x "$BENCH" ] && "$BENCH" --plugin --runs "$PLUGIN_RUNS" "${PLUGIN_SOURCES[@]}" >"$TMP/rust-plugin.txt" 2>/dev/null ||
  echo "Rust plugin failed" >&2
TABLE_F="| Source | Bytes | Reference median µs | Reference min µs | Reference mean µs | Rust median µs | Rust min µs | Rust mean µs | Median speedup |
|---|---:|---:|---:|---:|---:|---:|---:|---:|"
for source in "${PLUGIN_SOURCES[@]}"; do
  ref_line=$(grep -F "\"source\":\"$source\"" "$TMP/ref-plugin.txt" || true)
  rust_line=$(grep -F "\"source\":\"$source\"" "$TMP/rust-plugin.txt" 2>/dev/null || true)
  field() { jq -r ".$2 // empty" <<<"$1"; }
  r_med=$(field "$ref_line" median_us) s_med=$(field "$rust_line" median_us)
  TABLE_F+="
| \`$source\` | $(bytes "$source") | $(fmt "$r_med") | $(fmt "$(field "$ref_line" min_us)") | $(fmt "$(field "$ref_line" mean_us)") | $(fmt "$s_med") | $(fmt "$(field "$rust_line" min_us)") | $(fmt "$(field "$rust_line" mean_us)") | $(ratio "$r_med" "$s_med" '%.1fx') |"
done

# (b) Cold start: process start to a printed result for `return 1`, median of COLD_RUNS processes. Without bash 5's
# $EPOCHREALTIME (macOS ships bash 3.2), perl's clock times each run around the command it starts.
cold() { # command...
  "$@" >/dev/null 2>&1 || return 1
  if [ -z "${EPOCHREALTIME:-}" ]; then
    perl -MTime::HiRes=time -e 'open(my $out, ">&", \*STDOUT); open(STDOUT, ">", "/dev/null"); open(STDERR, ">", "/dev/null");
      my $n = shift; for (1 .. $n) { my $s = time; system(@ARGV) == 0 or exit 1; printf $out "%.3f\n", (time - $s) * 1000 }' \
      "$COLD_RUNS" "$@"
    return
  fi
  for _ in $(seq "$COLD_RUNS"); do
    local start=$EPOCHREALTIME
    "$@" >/dev/null 2>&1 || return 1
    awk -v a="$start" -v b="$EPOCHREALTIME" 'BEGIN { printf "%.3f\n", (b - a) * 1000 }'
  done
}
echo "(b) cold start" >&2
ref_cold=$(cold bun bench/ref/embed.ts | median)
rust_cold=""
[ -x "$EMBED" ] && rust_cold=$(cold "$EMBED" | median)
TABLE_B="| Implementation | Median wall ms ($COLD_RUNS runs) |
|---|---:|
| Reference (bun bench/ref/embed.ts) | $(fmt "$ref_cold") |
| Rust (embed example) | $(fmt "$rust_cold") |"

# (c) Peak RSS per case, each case once in a fresh process: GNU time reports KiB, the BSD time on macOS bytes.
rss() { # command... -> MiB
  if [ "$(uname -s)" = Darwin ]; then
    /usr/bin/time -l "$@" 2>"$TMP/time.txt" >/dev/null || return 1
    awk '/maximum resident set size/ { printf "%.1f\n", $1 / 1048576 }' "$TMP/time.txt"
    return
  fi
  /usr/bin/time -v "$@" 2>"$TMP/time.txt" >/dev/null || return 1
  awk -F': ' '/Maximum resident set size/ { printf "%.1f\n", $2 / 1024 }' "$TMP/time.txt"
}
echo "(c) peak RSS" >&2
TABLE_C="| Case | Reference peak RSS MiB | Rust peak RSS MiB |
|---|---:|---:|"
for i in "${!SLUGS[@]}"; do
  slug=${SLUGS[$i]}
  ref_rss=$(rss bun bench/ref/run-case.ts "$slug")
  rust_rss=""
  [ -x "$BENCH" ] && rust_rss=$(rss "$BENCH" --filter "$slug" --iterations 0)
  TABLE_C+="
| ${NAMES[$i]} | $(fmt "$ref_rss") | $(fmt "$rust_rss") |"
done

# (d) Shipped size, once the embed example runs.
BUN_BIN=$(readlink -f "$(command -v bun)")
bun_size=$(bytes "$BUN_BIN")
mib() { awk -v b="$1" 'BEGIN { printf "%.2f", b / 1048576 }'; }
embed_row="| Rust embed example, release, stripped | n/a | n/a |"
if [ -x "$EMBED" ] && "$EMBED" >/dev/null 2>&1; then
  strip -o "$TMP/embed" "$EMBED"
  embed_size=$(bytes "$TMP/embed")
  embed_row="| Rust embed example, release, stripped | $embed_size | $(mib "$embed_size") |"
fi
TABLE_D="| Artifact | Bytes | MiB |
|---|---:|---:|
$embed_row
| bun executable (what you ship otherwise) | $bun_size | $(mib "$bun_size") |"

if [ -r /proc/cpuinfo ]; then
  CPU=$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | sed 's/^ //')
  MEM=$(awk '/MemTotal/ { printf "%.0f GiB", $2 / 1048576 }' /proc/meminfo)
  CORES=$(nproc) OS="Linux $(uname -r)"
else
  CPU=$(sysctl -n machdep.cpu.brand_string)
  MEM=$(sysctl -n hw.memsize | awk '{ printf "%.0f GiB", $1 / 1073741824 }')
  CORES=$(sysctl -n hw.ncpu) OS="macOS $(sw_vers -productVersion) $(uname -m)"
fi
cat >"$OUT" <<EOF
# Benchmark results

Generated by \`bench/compare.sh\` on $(date -u +%Y-%m-%d). "n/a" means the Rust side could not run the case.

Columns say whether they are a median, a min or a mean. Every speed-up and ratio is computed from medians only;
mins and means are shown for spread, never compared.

## Environment

- CPU: $CPU, $CORES cores, $MEM RAM, $OS
- Reference: anomalyco/opencode $(git -C "$REF_PKG" rev-parse HEAD), \`packages/codemode\`
- PsychoScript: $(git rev-parse HEAD)$(git diff --quiet HEAD -- crates bench conformance ':!bench/RESULTS.md' || echo " (with uncommitted changes)")
- bun $(bun --version); $(rustc --version); $(cargo --version)

## (a) Per-case wall time, $ITERATIONS iterations after one warm-up

$TABLE_A

¹ \`tools.echo\` is an async host function in a \`Host.namespace\` on both sides (\`conformance/reference.ts\` and
\`conformance/reference.rs\`); neither validates its input or output.

## (b) Cold start: process start to the result of \`return 1\`

$TABLE_B

## (c) Peak RSS, each case once in a fresh process

$TABLE_C

## (d) Binary size

$TABLE_D

## (e) Perturbed variants, $ITERATIONS iterations after one warm-up

Each program in \`bench/variants/\` computes the same result as its original, written differently: renamed
identifiers, equivalent constants, function expressions and named functions for callbacks, and other loop forms. A
variant / original ratio far from the reference's on one side only points at a shape-specific fast path.

$TABLE_E

## (f) Plugin event: µs per execute, $PLUGIN_RUNS runs after $PLUGIN_RUNS warm-up runs

The conformance reducer (\`plugin-reducer-*\`) handling \`{ type: "command", name: "git.status" }\` with the async
\`tools.git.status\` host function, through \`execute\` once per event. \`reducer.js\` is its command path;
\`reducer-padded.js\` is the whole reducer with eleven more command handlers before the matching one.

$TABLE_F

## Commands

\`\`\`sh
bash bench/compare.sh  # reference at ../codemode, or CODEMODE_REF=<codemode package dir>
cargo build --release --locked -p psychoscript-bench --bin psychoscript-bench --example embed
# (a)
bun bench/ref/bench.ts --iterations $ITERATIONS <slug>...
target/release/psychoscript-bench --filter <slug> --iterations $ITERATIONS --json
# (b) $COLD_RUNS timed runs each after one untimed run, wall time from bash \$EPOCHREALTIME (perl's clock without it)
bun bench/ref/embed.ts
target/release/examples/embed
# (c) -l instead of -v on macOS
/usr/bin/time -v bun bench/ref/run-case.ts <slug>
/usr/bin/time -v target/release/psychoscript-bench --filter <slug> --iterations 0
# (d) stat -f %z on macOS
strip -o embed target/release/examples/embed && stat -c %s embed
stat -c %s "\$(readlink -f "\$(command -v bun)")"
# (e) values must match their originals, on both sides
bun bench/ref/variants.ts --iterations $ITERATIONS <slug>...
target/release/psychoscript-bench --cases bench/variants --filter <slug> --iterations $ITERATIONS --json
# (f)
bun bench/ref/plugin.ts --runs $PLUGIN_RUNS bench/plugin/reducer.js bench/plugin/reducer-padded.js
target/release/psychoscript-bench --plugin --runs $PLUGIN_RUNS bench/plugin/reducer.js bench/plugin/reducer-padded.js
\`\`\`
EOF
echo "wrote $OUT" >&2
