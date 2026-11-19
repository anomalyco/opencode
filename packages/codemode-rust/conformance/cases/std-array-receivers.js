// Array.prototype methods called on what is not an array name themselves and what they got.
const names = ["at", "concat", "copyWithin", "entries", "every", "fill", "filter", "find", "findIndex", "findLast",
  "findLastIndex", "flat", "flatMap", "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "pop", "push",
  "reduce", "reduceRight", "reverse", "shift", "slice", "some", "sort", "splice", "toLocaleString", "toReversed",
  "toSorted", "toSpliced", "toString", "unshift", "values", "with"]
const out = []
for (const n of names) {
  for (const t of [1, "ab", { length: 2, 0: "x", 1: "y" }, null, undefined]) {
    try {
      Array.prototype[n].call(t, (x) => x, 0)
      out.push([n, "ok"])
    } catch (e) {
      out.push([n, e.name, e.message])
    }
  }
}
return out
