// Results that are exact, so every libm and compiler agrees; std-math-hypot-inexact covers rounded ones.
const r = []
try { Math.hypot(Infinity, { valueOf() { throw new Error("x") } }) } catch (e) { r.push(e.message) }
const ones = (n) => Array.from({ length: n }, () => 1)
r.push(Math.hypot(), Math.hypot(-0), Math.hypot(3, 4), Math.hypot(NaN, Infinity), Math.hypot(3 * 2 ** 1021, 4 * 2 ** 1021), Math.hypot(0.75, -1), Math.hypot(-3))
r.push(Math.hypot(1, 2, 2), Math.hypot(1, 4, 8), Math.hypot(-2, 4, -4), Math.hypot(2 ** -1000, 2 ** -999, 2 ** -999), Math.hypot(0, 0, 0), Math.hypot(NaN, 1, Infinity))
r.push(Math.hypot(1, 1, 1, 1), Math.hypot(2, ...ones(12)), Math.hypot(1, 2, ...ones(11)), Math.hypot(-0.5, 0.5, 0.5, 0.5), Math.hypot(2 ** 1000, 2 ** 1000, 2 ** 1000, 2 ** 1000), Math.hypot(0, 0, 0, 0), Math.hypot(NaN, 1, 2, Infinity))
return r.map(String)
