const kinds = [() => { throw new Error("e") }, () => { throw new TypeError("t") }, () => { throw new RangeError("r") }]
return kinds.map((f) => { try { f() } catch (e) { return [e.name, e.message, String(e), e instanceof Error, e instanceof TypeError, e instanceof RangeError] } })
