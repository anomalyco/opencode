const m = new Map()
return [[] instanceof Array, [] instanceof Object, ({}) instanceof Array, m instanceof Map, new Set() instanceof Set, new Error("x") instanceof Error, new TypeError("x") instanceof Error]
