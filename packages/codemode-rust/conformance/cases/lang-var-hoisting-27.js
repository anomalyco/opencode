function* g() {}
async function* ag() {}
function f() {}
return [g() instanceof g, ag() instanceof ag, g.prototype === ag.prototype, typeof g.prototype, typeof f.prototype]
