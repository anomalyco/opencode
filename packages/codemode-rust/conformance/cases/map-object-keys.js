const k1 = { id: 1 }, k2 = { id: 1 }
const m = new Map([[k1, "one"]])
m.set(1, "number").set("1", "string")
return [m.get(k1), m.get(k2), m.get(1), m.get("1"), m.size]
