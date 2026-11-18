// Results that are exact, so every libm agrees; std-pow-inexact covers rounded ones.
const o = []
for (let k = 0; k <= 1000; k += 7) o.push(String(10 ** k), String(Math.pow(1.1, k)), String((-3.3) ** (k % 40)))
for (let k = -1074; k <= 1023; k += 13) o.push(String(2 ** k), String(Math.pow(0.5, -k)), String((-2) ** (k + 51)))
o.push(String(4 ** 1.5), String(16 ** 0.25), String(0.25 ** -511.5), String(2 ** 1024), String((-2) ** 1001), String(2 ** 1001), String(2 ** -1074))
o.push(String((-8) ** (1 / 3)), String(0 ** -0.5), String((-0) ** 0.5), String(Infinity ** -0.5), String(4 ** 0.5), String(2 ** 1000), String(1.0000001 ** 1000), String(NaN ** 0), String(1 ** Infinity), String((-1) ** -Infinity), String(Math.pow(-0, -3)), String(Math.pow(-0, 3)), String(Math.pow(5e-324, 0.5)), String(Math.pow(5e-324, 2)))
return o
