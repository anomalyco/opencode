// @platform "linux"
// Fractional and negative exponents go to the system libm's pow, and libms round differently, so this case is recorded and checked on Linux only.
const o = []
for (let k = -330; k <= 310; k += 3) o.push(String(10 ** k), String(Math.pow(1.1, k)), String(2.5 ** (k / 7)), String((-3.3) ** (k % 40)))
o.push(String((-8) ** (1 / 3)), String(0 ** -0.5), String((-0) ** 0.5), String(Infinity ** -0.5), String(4 ** 0.5), String(2 ** 1000), String(2 ** 1001), String(1.0000001 ** 1000), String(NaN ** 0), String(1 ** Infinity), String((-1) ** -Infinity), String(Math.pow(-0, -3)), String(Math.pow(-0, 3)), String(Math.pow(5e-324, 0.5)), String(Math.pow(5e-324, 2)))
return o
