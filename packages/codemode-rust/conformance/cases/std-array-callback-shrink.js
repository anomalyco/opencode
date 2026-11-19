const out = []
const run = (name, f) => { const a = [1, 2, 3, 4, 5, 6]; const seen = []; const r = a[name]((...xs) => { seen.push(xs[name.startsWith("reduce") ? 2 : 1]); if (seen.length === 2) a.length = 3; return f(...xs) }, ...(name.startsWith("reduce") ? [0] : [])); out.push(name + ":" + seen.join("") + ":" + JSON.stringify(r)) }
for (const n of ["forEach", "map", "filter", "some", "every", "find", "findIndex", "findLast", "findLastIndex", "flatMap", "reduce", "reduceRight"]) run(n, (x) => n === "every" ? true : n === "some" ? false : x)
const b = [1, 2, 3, 4]
b.forEach((x, i) => { if (i === 0) b.push(9) ; out.push(x) })
const c = [5, 6, 7, 8]
out.push(c.reduceRight((acc, x, i) => { if (i === 3) c.length = 2; return acc + x }, ""))
const d = [1, 2, 3]
out.push(JSON.stringify(d.map((x, i) => { if (i === 0) d.length = 1; return x * 2 })), d.length)


const fi = { valueOf() { out.push("v"); return 0 } }; out.push([].includes(1, fi), [].indexOf(1, fi), [].lastIndexOf(1, fi), [1].includes(1, fi), [1].indexOf(1, fi), [1].lastIndexOf(1, fi)); return out

