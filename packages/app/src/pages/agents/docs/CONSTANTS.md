# Agents constants ledger

Single source of truth for magic values used by `src/pages/agents/**`.
Update here first, then code.

## Spark / blocks

- `BLOCKS = ["▁","▂","▃","▄","▅","▆","▇","█"]` — 8 levels, index `0..7`.
- `SPARK_N = 18` — fixed spark width; see `lib/bucket.ts`.
- `sparkString(vals, width=18)`: per-row-peak normalization, scale
  `floor(v / peak * 7.999)`, zeros / nonfinite → `"·"`, left-pad with `"·"` to `width`.
- No normalization across rows; each spark call peaks independently.

## Colors

- Live spark: `rgba(107,230,140,.95)`; idle spark: `rgba(107,230,140,.52)`.
- Pulse: working `#4ade80` (green), permission `#fbbf24` (amber),
  error `#f87171` (red), unseen `#4da3ff` (blue), idle `·` dim `rgba(148,163,184,.55)`.
- Stage severity → color: cyan SPEC, mid PLAN, green BUILD, amber GATE/BLOCKED-perm,
  bright REVIEW, dim IDLE, red BLOCKED-error.

## Font

- Spark/pulse mono stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
  `14px`, `tabular-nums`, `white-space: pre`.

## Columns

- Default table: `pulse | name | stage | ttft | 1m out | rate | tokens | spark`.
- Token column shows `tok(total)` with cache share `pctText(share*100)` when share > 0.
- Rate column shows `rateText(outPerMin)` only when `isRateWorthy(out)` else `—`.

## Windows

- `WINDOW_SECS = {'5m':300,'1h':3600,'24h':86400}`.
- Bucketize: 18 equal buckets over `[now-secs, now]`,
  `idx=min(17, floor((t-start)/(secs/18)))`, `t in (now,now+1]` → last bucket,
  older than start or `> now+1` dropped. Negatives / NaN-safe, `out` clamped `≥0`.
- `rollingOut1m`: sum over `(now-60, now]`.

## RATE_MIN_OUT / token math

- `RATE_MIN_OUT = 50` — minimum 1m output tokens before showing a rate.
- `tok(n)`: `<1000` integer, else `k/M/G/T` one decimal (`999960 → 1.0M`, `12400 → 12.4k`).
- `rateText(v)`: null/≤0/nonfinite → `—`; `<10` one decimal; else rounded int; `>9999` → `"9999"`.
- `money(v)`: tier scan `[[1,2],[1,1],[1e3,2,"k"],[1e3,1,"k"],[1e6,2,"M"],…]` first `len≤6`
  wins (`41.2 → 41.20`, `1234567 → 1.23M`); NaN → `—`; `±Infinity` → `±999B+`.
- `pctText(v)`: `floor(v)%`; nonfinite → `—`.
- `latText(s)`: null/neg/nonfinite → `—`; `<1` ms (`0.84 → 840ms`); `<10` one decimal;
  `<100` int seconds; else `99s+`.
- `tokTotal = input+output+reasoning`; `cacheShare = min(1,max(0,read/input))`, 0 on bad/zero.

## TTFT

- `blockedSeconds`: union of permission windows clipped to `[promptAt,firstPartAt]`;
  open windows (`repliedAt==null`) end at `firstPartAt`.
- `ttftSeconds = max(0, first-prompt-blocked)`; null if bad `promptAt` (`≤0`/nonfinite)
  or null `firstPartAt`.
- `permissionPending = any repliedAt==null`.
- Consumer joins asked→replied per sessionID; no special-casing; `RATE_MIN_OUT` never applies.

## Stage precedence (exact order)

1. `archived/deleted` → `IDLE/dim`
2. `permissionPending && busy` → `BLOCKED/amber`
3. `error/retry` → `BLOCKED/red`
4. `permissionPending` → `BLOCKED/amber`
5. `toolRunning || busy` → `BUILD/green`
6. `questionPending` → `GATE/amber`
7. `diffNonEmpty && idle` → `REVIEW/bright`
8. `todosActive` → `BUILD/green`
9. `todosProposed` → `PLAN/mid`
10. `busy` → `BUILD/green`
11. `idle` → `IDLE/dim`
12. default → `SPEC/cyan`
- No sandbox branching.

## Split / persist

- Keys: `agents.graphIdx` (window), `agents.filter`, `agents.project`,
  `agents.splitOpen`, `agents.enabled`.
- `loadWindow/saveWindow` validate `5m|1h|24h` else `5m`; `loadFilter/saveFilter` else `all`;
  `loadProject/saveProject` JSON string|null; `loadSplitOpen/saveSplitOpen` `1/0` default true;
  `isEnabled/setEnabled` default false. Never throw; guarded localStorage + memory fallback.

## Route + session URL

- Route: `/agents` (flag-gated).
- Session URL: `/session/:id` — agents rows link out, never embed session internals.

## Event ALLOW list

- `session.updated`, `session.idle`, `turn.part`, `permission.asked`, `permission.replied`,
  `turn.diff`, `todo.updated`, `compact.done`, `fork.created`.

## FORBIDDEN phantom list (do not invent)

- `agents.tick`, `agents.spark`, `agents.stageChanged`, `session.tokenStream`,
  `turn.blocked`, `permission.timeout`, `sandbox.spawned`, `desktop.focused`,
  `router.prefetch`, `serverSync.flush`, `notification.push`.
