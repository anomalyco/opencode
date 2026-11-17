let seed = 12345
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const out = []
for (let i = 0; i < 400; i++) {
  const x = (rnd() - 0.5) * 10 ** Math.floor(rnd() * 40 - 20)
  const r = 2 + Math.floor(rnd() * 35)
  const d = Math.floor(rnd() * 20)
  out.push([x.toString(r), x.toExponential(d), x.toPrecision(d + 1), x.toFixed(d), x.toExponential(), String(x)].join("|"))
}
return out
