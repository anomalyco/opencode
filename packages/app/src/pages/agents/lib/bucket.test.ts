import { SPARK_N, bucketize, dedupeForks, resetOn, rollingOut1m, sumSparks } from "./bucket";

function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`bucket assert failed: ${msg}`);
}
function eq(a: unknown, b: unknown, msg: string): void {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`bucket assert failed: ${msg}: got ${sa} want ${sb}`);
}

check(SPARK_N === 64, "SPARK_N=64");

// 5m exact indexes at now=1800, secs=300, span=300/64=4.6875: 1500->0, 1650->32, 1800->63
{
  const now = 1800;
  const secs = 300;
  const ticks = [
    { t: 1500, out: 1, sessionID: "s" },
    { t: 1650, out: 2, sessionID: "s" },
    { t: 1800, out: 4, sessionID: "s" },
  ];
  const sparks = bucketize(ticks, now, secs);
  check(sparks.length === 64, "bucketize length 64");
  check(sparks[0] === 1, "1500->bucket0");
  check(sparks[32] === 2, "1650->bucket32");
  check(sparks[63] === 4, "1800->bucket63");
}

// oow dropped
{
  const sparks = bucketize(
    [
      { t: 1499.9, out: 100, sessionID: "s" },
      { t: 1800 + 1.01, out: 100, sessionID: "s" },
      { t: 1500, out: 1, sessionID: "s" },
    ],
    1800,
    300,
  );
  const total = sparks.reduce((a, b) => a + b, 0);
  eq(total, 1, "oow dropped");
}

// single-tick -> bucket63
{
  const sparks = bucketize([{ t: 1800, out: 7, sessionID: "s" }], 1800, 300);
  eq(sparks[63], 7, "single-tick bucket63");
  eq(
    sparks.slice(0, 63).reduce((a, b) => a + b, 0),
    0,
    "single-tick rest zero",
  );
}

// empty -> zeros
{
  eq(bucketize([], 1800, 300), new Array(64).fill(0), "empty zeros");
}

// rollingOut1m boundary at now=1000: 940 excl, 941+1000 incl, 1001 excl -> 5
{
  const total = rollingOut1m(
    [
      { t: 940, out: 100, sessionID: "s" },
      { t: 941, out: 2, sessionID: "s" },
      { t: 1000, out: 3, sessionID: "s" },
      { t: 1001, out: 100, sessionID: "s" },
    ],
    1000,
  );
  eq(total, 5, "rollingOut1m boundary");
}

// sumSparks element-wise, no norm
{
  eq(sumSparks([1, 2, 3], [4, 5, 6]), [5, 7, 9], "sumSparks element-wise");
  eq(sumSparks([1, 1, 1, 1], [0, 0, 0, 0]), [1, 1, 1, 1], "sumSparks identity");
}

// dedupeForks drops fork replay keeps first
{
  const ticks = [
    { t: 1, out: 1, sessionID: "a", turnID: "t1" },
    { t: 2, out: 2, sessionID: "b", turnID: "t1", parentID: "t1" },
    { t: 3, out: 3, sessionID: "a", turnID: "t2" },
    { t: 4, out: 4, sessionID: "c" },
  ];
  const kept = dedupeForks(ticks);
  eq(kept.length, 3, "dedupeForks length");
  eq(kept[0].sessionID, "a", "dedupe keeps first");
  check(
    kept.every((k) => !(k.turnID === "t1" && k.sessionID === "b")),
    "dedupe drops fork replay",
  );
  check(
    kept.some((k) => k.turnID === "t2"),
    "dedupe keeps distinct turn",
  );
  check(
    kept.some((k) => k.turnID === undefined),
    "dedupe keeps turnID-less",
  );
  // same-session repeat is kept
  const same = dedupeForks([
    { t: 1, out: 1, sessionID: "a", turnID: "t1" },
    { t: 2, out: 2, sessionID: "a", turnID: "t1" },
  ]);
  eq(same.length, 2, "dedupe keeps same-session");
}

// skew clamp: (now, now+1] -> last bucket, beyond dropped; negatives/NaN-safe, out clamped
{
  const now = 1800;
  const secs = 300;
  const sparks = bucketize([{ t: now + 0.5, out: 5, sessionID: "s" }], now, secs);
  eq(sparks[63], 5, "skew clamp to last bucket");
  const dropped = bucketize([{ t: now + 5, out: 5, sessionID: "s" }], now, secs);
  eq(
    dropped.reduce((a, b) => a + b, 0),
    0,
    "far future dropped",
  );
  const neg = bucketize(
    [
      { t: 1500, out: -10, sessionID: "s" },
      { t: 1510, out: NaN, sessionID: "s" },
      { t: NaN, out: 10, sessionID: "s" },
    ],
    now,
    secs,
  );
  eq(
    neg.reduce((a, b) => a + b, 0),
    0,
    "negatives NaN-safe out clamped",
  );
}

// resetOn -> 'reset'
{
  eq(resetOn("reset"), "reset", "resetOn reset");
  eq(resetOn("nope"), null, "resetOn null");
}
