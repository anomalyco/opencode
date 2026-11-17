let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const out = [...[[-1], [-0.1], [1, -1, -1], [-8.8], [-Number.MAX_VALUE]].map((a) => Math.sumPrecise(a)), Math.sumPrecise([-1e-300, 1e-300 * 0.5]), Math.sumPrecise([1e-300, -5e-301]), Math.sumPrecise([]), Object.is(Math.sumPrecise([-0]), -0), Math.sumPrecise([1e308, 1e308, -1e308]), Math.sumPrecise([1e308, 1e308]), Math.sumPrecise([5e-324, -5e-324]), Math.sumPrecise([-5e-324]), Math.sumPrecise([0.1, 0.2, 0.3])]
for (let i = 0; i < 400; i++) { const n = 1 + Math.floor(rnd() * 6); const xs = []; for (let j = 0; j < n; j++) xs.push((rnd() - 0.6) * 10 ** Math.floor(rnd() * 600 - 320)); out.push(String(Math.sumPrecise(xs))) }
for (let i = 0; i < 400; i++) { const n = 1 + Math.floor(rnd() * 4); const xs = []; for (let j = 0; j < n; j++) xs.push((rnd() - 0.5) * 2 ** Math.floor(rnd() * 20 - 10)); out.push(String(Math.sumPrecise(xs))) }
return out.map(String)
