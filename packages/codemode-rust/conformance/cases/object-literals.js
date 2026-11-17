const k = "dyn", a = 1
const o = { a, [k + "Key"]: 2, 3: "three", "quoted-key": 4, m(x) { return x + this.a }, nested: { deep: [1, { z: true }] } }
o.added = 5
delete o.a
return [o, o.m === undefined, "added" in o, "a" in o, Object.keys(o)]
