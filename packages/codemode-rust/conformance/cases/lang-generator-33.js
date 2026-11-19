const captured = 4
function* declaration(x, y = x, ...rest) { yield captured + y + rest[0] }
const expression = function* (x, y = x) { yield captured + y }
const object = { *method({ value }, extra = 1) { return captured + value + extra } }
return [declaration(2, undefined, 3).next(), expression(5).next(), object.method({ value: 6 }).next()]
