# Agents fixture catalog

Each fixture lists signals-in → expected stage/spark/latency.
Use for manual verification and soak tests. Times are synthetic epoch seconds.

## working-build

- signals-in: `{ toolRunning: true, busy: true }`, ticks `[{t:1790,out:120},{t:1800,out:80}]`,
  windows `[]`, prompt `1700` first `1700.9`.
- expected: `BUILD/green`, pulse working, spark last bucket non-zero, `ttft 0.9s`, rate worthy.

## gate-question

- signals-in: `{ questionPending: true }`, no ticks, no windows.
- expected: `GATE/amber`, pulse permission? (question is gate, not permission),
  spark all `·`, rate `—`.

## review-diff-idle

- signals-in: `{ diffNonEmpty: true, idle: true }`.
- expected: `REVIEW/bright`, pulse idle? row shows `·`, spark zeros.

## permission-blocked

- signals-in: `{ permissionPending: true }` + open window `{askedAt:101,repliedAt:null}`,
  prompt `100` first `102`.
- expected: `BLOCKED/amber`, `permissionPending true`, `blocked 1.0`, `ttft 1.0`.

## error-retry

- signals-in: `{ error: true }` and variant `{ retry: true }`.
- expected: `BLOCKED/red`, pulse error.

## idle-quiet

- signals-in: `{ idle: true }`, no ticks.
- expected: `IDLE/dim`, spark `·×18`, rate `—`.

## archived

- signals-in: `{ archived: true, error: true }`.
- expected: `IDLE/dim` (archived wins over error).

## deleted

- signals-in: `{ deleted: true, permissionPending: true, busy: true }`.
- expected: `IDLE/dim` (deleted wins).

## compacted

- signals-in: `resetOn("compact") === "reset"`, ticks pre-compact dropped, fresh window.
- expected: spark reset to zeros, rolling 1m restarts.

## parentID-fork pair

- signals-in: ticks
  `[{t:1,out:10,sessionID:"a",turnID:"t1"},{t:2,out:10,sessionID:"b",turnID:"t1",parentID:"t1"}]`.
- expected: `dedupeForks` keeps first (`a/t1`), drops cross-session replay (`b/t1`).

## sandbox+local pair

- signals-in: same turnID in same session from sandbox and local
  `[{sessionID:"a",turnID:"t1"},{sessionID:"a",turnID:"t1"}]`.
- expected: both kept (same-session repeats are not forks); stage has no sandbox branching.

## soak-200 generator

- signals-in: script generates 200 sessions × 50 ticks with mixed windows/errors;
  run `bucketize` + `mapStage` + `ttftSeconds` over all.
- expected: no throw, all sparks length 18, all stages in enum, `sumSparks` equals
  element-wise total, `rollingOut1m` matches brute-force filter.
