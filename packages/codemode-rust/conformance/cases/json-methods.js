const v = { a: [1, "two", null, true], b: { c: 1.5 }, u: undefined, f: () => 1 }
const s = JSON.stringify(v)
return [s, JSON.stringify(v, null, 2), JSON.parse(s), JSON.stringify([undefined, () => 1]), JSON.stringify("q\"uote\n"), JSON.parse("[1, {\"x\": \"y\"}]"), JSON.stringify(undefined) === undefined]
